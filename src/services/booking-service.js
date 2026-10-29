const axios = require("axios");
const crypto = require("crypto");
const {StatusCodes} = require("http-status-codes")
const AppError = require("../utils/errors/app-error");
const { bookingRepository } = require("../repositories");
const {serverConfig,queue,logger} = require("../config");
const db = require("../models");
const {enums} = require('../utils/common');
const { BOOKED, CANCELLED, INITIATED } = enums.BOOKING_STATUS;
const bookingRepo = new bookingRepository();
const PaymentAttempt = db.PaymentAttempt;
const RefundAttempt = db.RefundAttempt;

function assertSameBookingRequest(existing, data) {
  const sameRequest = Number(existing.userId) === Number(data.userId)
    && Number(existing.flightId) === Number(data.flightId)
    && Number(existing.noOfSeats) === Number(data.noOfSeats)
    && JSON.stringify(existing.passengerDetails || []) === JSON.stringify(data.passengerDetails || []);
  if (!sameRequest) {
    throw new AppError('This idempotency key was already used for a different booking request.', StatusCodes.CONFLICT);
  }
  return existing;
}

async function createBooking(data) {
  const existing = await bookingRepo.findByIdempotencyKey(data.idempotencyKey);
  if (existing) {
    assertSameBookingRequest(existing, data);
    if (existing.status === CANCELLED) throw new AppError('This booking request has expired or was cancelled.', StatusCodes.CONFLICT);
    return existing.status === enums.BOOKING_STATUS.PENDING ? completeSeatHold(existing.id) : existing;
  }

  const transaction = await db.sequelize.transaction();
   try {
        const flight = await axios.get(`${serverConfig.FLIGHT_SERVICE}/api/v1/flights/${data.flightId}`);
        const flightData = flight.data.data;
        if (!Number.isFinite(Date.parse(flightData?.departureTime)) || Date.parse(flightData.departureTime) <= Date.now()) {
            throw new AppError('This flight has already departed or its schedule is unavailable.', StatusCodes.CONFLICT);
        }
        if(data.noOfSeats > flightData.totalSeats) {
            throw new AppError('Not enough seats available', StatusCodes.BAD_REQUEST);
        }
        const totalBillingAmount = data.noOfSeats * flightData.price;
        const bookingPayload = {...data, totalCost: totalBillingAmount, status: enums.BOOKING_STATUS.PENDING};
        const booking = await bookingRepo.create(bookingPayload, transaction);
        await transaction.commit();
        return completeSeatHold(booking.id);
    } catch(error) {
        if (!transaction.finished) await transaction.rollback();
        if (error.name === 'SequelizeUniqueConstraintError') {
            const duplicate = await bookingRepo.findByIdempotencyKey(data.idempotencyKey);
            if (duplicate) {
                assertSameBookingRequest(duplicate, data);
                if (duplicate.status === CANCELLED) throw new AppError('This booking request has expired or was cancelled.', StatusCodes.CONFLICT);
                return duplicate.status === enums.BOOKING_STATUS.PENDING ? completeSeatHold(duplicate.id) : duplicate;
            }
        }
        throw error;
    }
}

async function completeSeatHold(bookingId) {
    const transaction = await db.sequelize.transaction();
    try {
        const booking = await bookingRepo.get(bookingId, transaction, true);
        if (booking.status === CANCELLED) throw new AppError('This booking request has expired or was cancelled.', StatusCodes.CONFLICT);
        if (booking.status !== enums.BOOKING_STATUS.PENDING) {
            await transaction.commit();
            return booking;
        }
        if (Date.now() - new Date(booking.createdAt).getTime() > 300000) {
            await transaction.rollback();
            await cancelBooking(bookingId, true);
            throw new AppError('The booking hold has expired.', StatusCodes.CONFLICT);
        }

        await axios.patch(`${serverConfig.FLIGHT_SERVICE}/api/v1/flights/${booking.flightId}/seats`, {
            seats: booking.noOfSeats,
            operationId: `booking-hold-${booking.idempotencyKey}`,
        });
        await bookingRepo.update(bookingId, { status: INITIATED }, transaction);
        await transaction.commit();
        return bookingRepo.get(bookingId);
    } catch (error) {
        if (!transaction.finished) await transaction.rollback();
        throw error;
    }
  }
  
function paymentSignatureMatches(orderId, paymentId, signature) {
    if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
    const expected = crypto.createHmac('sha256', serverConfig.RAZORPAY_KEY_SECRET)
        .update(`${orderId}|${paymentId}`)
        .digest();
    const supplied = Buffer.from(signature, 'hex');
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

async function verifyRazorpayPayment({ bookingId, userId, orderId, paymentId, signature }) {
    if (!serverConfig.RAZORPAY_KEY_ID || !serverConfig.RAZORPAY_KEY_SECRET) {
        throw new AppError('Razorpay API credentials are not configured in Booking Service.', StatusCodes.SERVICE_UNAVAILABLE);
    }

    const transaction = await db.sequelize.transaction();
    let booking;
    let attempt;
    try {
        booking = await bookingRepo.get(bookingId, transaction, true);
        if (Number(booking.userId) !== Number(userId)) {
            throw new AppError('Booking not found.', StatusCodes.NOT_FOUND);
        }
        attempt = await PaymentAttempt.findOne({
            where: { bookingId, providerOrderId: orderId },
            transaction,
            lock: transaction.LOCK.UPDATE,
        });
        if (!attempt) throw new AppError('Payment order does not belong to this booking.', StatusCodes.BAD_REQUEST);
        if (['captured', 'late_capture'].includes(attempt.status) && attempt.providerPaymentId !== paymentId) {
            throw new AppError('This payment attempt is already associated with a different payment.', StatusCodes.CONFLICT);
        }
        if (!paymentSignatureMatches(attempt.providerOrderId, paymentId, signature)) {
            throw new AppError('Razorpay payment signature is invalid.', StatusCodes.BAD_REQUEST);
        }

        if (attempt.status === 'captured' && booking.status === BOOKED) {
            await transaction.commit();
            return { status: 'captured', bookingId: booking.id, duplicate: true };
        }
        if (attempt.status === 'late_capture') {
            await transaction.commit();
            return { status: 'late_capture', bookingId: booking.id, duplicate: true };
        }

        const paymentResponse = await axios.get(`https://api.razorpay.com/v1/payments/${paymentId}`, {
            auth: { username: serverConfig.RAZORPAY_KEY_ID, password: serverConfig.RAZORPAY_KEY_SECRET },
            timeout: 10000,
        });
        const payment = paymentResponse.data;
        if (payment.order_id !== attempt.providerOrderId
            || Number(payment.amount) !== Number(attempt.amount)
            || payment.currency !== attempt.currency) {
            throw new AppError('Razorpay payment does not match the saved order amount or currency.', StatusCodes.CONFLICT);
        }

        if (payment.status === 'authorized') {
            await attempt.update({ status: 'authorized' }, { transaction });
            await transaction.commit();
            return { status: 'authorized', bookingId: booking.id };
        }
        if (payment.status === 'failed') {
            await attempt.update({ status: 'failed' }, { transaction });
            await transaction.commit();
            return { status: 'failed', bookingId: booking.id };
        }
        if (payment.status !== 'captured') {
            await transaction.commit();
            return { status: payment.status || 'pending', bookingId: booking.id };
        }

        const holdExpired = Date.now() - new Date(booking.createdAt).getTime() > 300000;
        if (booking.status !== INITIATED || holdExpired) {
            await attempt.update({ status: 'late_capture', providerPaymentId: payment.id }, { transaction });
            await getOrCreateRefundAttempt({ bookingId: booking.id, paymentAttemptId: attempt.id, reason: 'late_capture', transaction });
            await transaction.commit();
            if (booking.status === INITIATED && holdExpired) await cancelBooking(booking.id, true);
            return { status: 'late_capture', bookingId: booking.id, refundStatus: 'queued' };
        }

        await attempt.update({ status: 'captured', providerPaymentId: payment.id }, { transaction });
        await bookingRepo.update(booking.id, { status: BOOKED }, transaction);
        await transaction.commit();
    } catch (error) {
        if (!transaction.finished) await transaction.rollback();
        if (error instanceof AppError) throw error;
        throw new AppError('Could not verify payment status with Razorpay. Retry verification.', StatusCodes.BAD_GATEWAY);
    }

    const primaryPassenger = booking.passengerDetails?.[0];
    if (primaryPassenger?.email) {
        const passengerNames = booking.passengerDetails.map(({ fullName }) => fullName).join(', ');
        try {
            await queue.sendData({
                text: `Your SkyLink booking ${booking.id} is confirmed. Flight: ${booking.flightId}. Passengers: ${passengerNames}. Total: ${booking.totalCost}.`,
                subject: `Booking ${booking.id} confirmed`,
                recepientEmail: primaryPassenger.email,
            });
        } catch (notificationError) {
            console.error('Could not queue booking confirmation email', notificationError);
        }
    }
    return { status: 'captured', bookingId: booking.id };
}

function webhookSignatureMatches(rawBody, signature) {
    if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
    const expected = crypto.createHmac('sha256', serverConfig.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest();
    const supplied = Buffer.from(signature, 'hex');
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

async function getOrCreateRefundAttempt({ bookingId, paymentAttemptId, reason, transaction }) {
    const paymentAttempt = await PaymentAttempt.findOne({
        where: { id: paymentAttemptId, bookingId },
        transaction,
        lock: transaction.LOCK.UPDATE,
    });
    if (!paymentAttempt || !['captured', 'late_capture'].includes(paymentAttempt.status) || !paymentAttempt.providerPaymentId) {
        throw new AppError('A captured Razorpay payment is required before refunding.', StatusCodes.CONFLICT);
    }

    const latest = await RefundAttempt.findOne({
        where: { paymentAttemptId },
        order: [['attemptNumber', 'DESC']],
        transaction,
        lock: transaction.LOCK.UPDATE,
    });
    if (latest && latest.status !== 'failed') return latest;

    const attemptNumber = (latest?.attemptNumber || 0) + 1;
    return RefundAttempt.create({
        bookingId,
        paymentAttemptId,
        amount: paymentAttempt.amount,
        currency: paymentAttempt.currency,
        reason,
        status: 'queued',
        idempotencyKey: `skylink_refund_${paymentAttemptId}_${attemptNumber}`,
        receipt: `skylink-r-${paymentAttemptId}-${attemptNumber}`,
        attemptNumber,
    }, { transaction });
}

async function ensureRefundAttempt(input) {
    const transaction = await db.sequelize.transaction();
    try {
        const refundAttempt = await getOrCreateRefundAttempt({ ...input, transaction });
        await transaction.commit();
        return refundAttempt;
    } catch (error) {
        if (!transaction.finished) await transaction.rollback();
        throw error;
    }
}

const refundStatusPriority = { queued: 0, pending: 1, failed: 2, processed: 3 };

async function saveRefundStatus(refundAttemptId, status, providerRefundId = null) {
    const transaction = await db.sequelize.transaction();
    try {
        const refundAttempt = await RefundAttempt.findByPk(refundAttemptId, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });
        if (refundStatusPriority[status] >= refundStatusPriority[refundAttempt.status]) {
            await refundAttempt.update({
                status,
                ...(providerRefundId ? { providerRefundId } : {}),
            }, { transaction });
        }
        await transaction.commit();
        return refundAttempt;
    } catch (error) {
        if (!transaction.finished) await transaction.rollback();
        throw error;
    }
}

async function requestRazorpayRefund(refundAttempt) {
    if (['pending', 'processed'].includes(refundAttempt.status)) return refundAttempt;
    if (!serverConfig.RAZORPAY_KEY_ID || !serverConfig.RAZORPAY_KEY_SECRET) {
        throw new AppError('Razorpay API credentials are not configured in Booking Service.', StatusCodes.SERVICE_UNAVAILABLE);
    }
    const paymentAttempt = await PaymentAttempt.findByPk(refundAttempt.paymentAttemptId);
    if (!paymentAttempt?.providerPaymentId) {
        throw new AppError('The captured Razorpay payment ID is unavailable for refund.', StatusCodes.CONFLICT);
    }

    try {
        const response = await axios.post(
            `https://api.razorpay.com/v1/payments/${paymentAttempt.providerPaymentId}/refund`,
            {
                amount: refundAttempt.amount,
                receipt: refundAttempt.receipt,
                notes: { bookingId: String(refundAttempt.bookingId), refundAttemptId: String(refundAttempt.id) },
            },
            {
                auth: { username: serverConfig.RAZORPAY_KEY_ID, password: serverConfig.RAZORPAY_KEY_SECRET },
                headers: { 'X-Refund-Idempotency': refundAttempt.idempotencyKey },
                timeout: 10000,
            },
        );
        const refund = response.data;
        if (refund.payment_id !== paymentAttempt.providerPaymentId
            || Number(refund.amount) !== Number(refundAttempt.amount)
            || refund.currency !== refundAttempt.currency) {
            throw new AppError('Razorpay refund does not match the saved payment amount or currency.', StatusCodes.CONFLICT);
        }
        const status = ['pending', 'processed', 'failed'].includes(refund.status) ? refund.status : 'pending';
        return saveRefundStatus(refundAttempt.id, status, refund.id);
    } catch (error) {
        if (error.response?.status === 409) {
            return saveRefundStatus(refundAttempt.id, 'pending');
        }
        if (error.response && error.response.status >= 400 && error.response.status < 500) {
            await saveRefundStatus(refundAttempt.id, 'failed');
            if (error instanceof AppError) throw error;
            throw new AppError('Razorpay rejected the refund request. Review the refund status before retrying.', StatusCodes.BAD_GATEWAY);
        }
        if (error instanceof AppError) throw error;
        throw new AppError('Razorpay refund status is uncertain. Retry the same cancellation to safely check it.', StatusCodes.BAD_GATEWAY);
    }
}

async function processQueuedRefundAttempts() {
    const queued = await RefundAttempt.findAll({
        where: { status: 'queued' },
        order: [['createdAt', 'ASC']],
        limit: 25,
    });
    let processed = 0;
    for (const refundAttempt of queued) {
        try {
            const updated = await requestRazorpayRefund(refundAttempt);
            if (refundAttempt.reason === 'cancellation' && ['pending', 'processed'].includes(updated.status)) {
                const booking = await bookingRepo.get(refundAttempt.bookingId);
                if (booking.status !== CANCELLED) await cancelBooking(booking.id);
            }
            processed += 1;
        } catch (error) {
            logger.error(`Could not process refund attempt ${refundAttempt.id}: ${error.message}`);
        }
    }
    return { processed, queued: queued.length - processed };
}

async function processRazorpayWebhook({ rawBody, signature, eventId }) {
    if (!serverConfig.RAZORPAY_WEBHOOK_SECRET) {
        throw new AppError('Razorpay webhook secret is not configured in Booking Service.', StatusCodes.SERVICE_UNAVAILABLE);
    }
    if (!webhookSignatureMatches(rawBody, signature)) {
        throw new AppError('Razorpay webhook signature is invalid.', StatusCodes.BAD_REQUEST);
    }

    let event;
    try {
        event = JSON.parse(rawBody.toString('utf8'));
    } catch {
        throw new AppError('Razorpay webhook body is not valid JSON.', StatusCodes.BAD_REQUEST);
    }
    if (typeof eventId !== 'string' || !/^evt_[a-zA-Z0-9]+$/.test(eventId)) {
        throw new AppError('Razorpay webhook event ID is invalid.', StatusCodes.BAD_REQUEST);
    }

    const transaction = await db.sequelize.transaction();
    let booking;
    let notify = false;
    try {
        const priorEvent = await db.PaymentWebhookEvent.findOne({ where: { eventId }, transaction });
        if (priorEvent) {
            await transaction.commit();
            return { duplicate: true, status: priorEvent.status };
        }

        const supportedEvent = ['payment.captured', 'payment.failed'].includes(event.event);
        const supportedRefundEvent = ['refund.created', 'refund.processed', 'refund.failed'].includes(event.event);
        const payment = event.payload?.payment?.entity;
        const refund = event.payload?.refund?.entity;
        let eventStatus = 'ignored';

        if (supportedEvent) {
            if (!payment?.id || !payment?.order_id) {
                throw new AppError('Razorpay payment webhook is missing its payment or order ID.', StatusCodes.BAD_REQUEST);
            }
            const attemptReference = await PaymentAttempt.findOne({ where: { providerOrderId: payment.order_id }, transaction });
            if (!attemptReference) {
                throw new AppError('No local payment attempt matches this Razorpay order.', StatusCodes.NOT_FOUND);
            }
            booking = await bookingRepo.get(attemptReference.bookingId, transaction, true);
            const attempt = await PaymentAttempt.findByPk(attemptReference.id, { transaction, lock: transaction.LOCK.UPDATE });

            if (Number(payment.amount) !== Number(attempt.amount) || payment.currency !== attempt.currency) {
                throw new AppError('Razorpay webhook payment does not match the saved amount or currency.', StatusCodes.CONFLICT);
            }

            if (event.event === 'payment.failed') {
                if (!['captured', 'late_capture'].includes(attempt.status)) {
                    await attempt.update({ status: 'failed' }, { transaction });
                }
                eventStatus = 'processed';
            } else if (payment.status !== 'captured') {
                throw new AppError('Razorpay captured event does not contain a captured payment.', StatusCodes.CONFLICT);
            } else if (attempt.providerPaymentId && attempt.providerPaymentId !== payment.id) {
                // Preserve the first captured payment identity; reconcile any extra captured payment separately.
                eventStatus = 'ignored';
                logger.warn(`Additional captured payment received for booking ${booking.id}; payment ${payment.id} requires reconciliation.`);
            } else if (attempt.status === 'captured' && booking.status === BOOKED) {
                eventStatus = 'processed';
            } else if (attempt.status === 'late_capture') {
                eventStatus = 'processed';
            } else {
                const holdExpired = Date.now() - new Date(booking.createdAt).getTime() > 300000;
                if (booking.status === INITIATED && !holdExpired) {
                    await attempt.update({ status: 'captured', providerPaymentId: payment.id }, { transaction });
                    await bookingRepo.update(booking.id, { status: BOOKED }, transaction);
                    notify = true;
                    eventStatus = 'processed';
                } else {
                    await attempt.update({ status: 'late_capture', providerPaymentId: payment.id }, { transaction });
                    await getOrCreateRefundAttempt({ bookingId: booking.id, paymentAttemptId: attempt.id, reason: 'late_capture', transaction });
                    eventStatus = 'processed';
                }
            }
        } else if (supportedRefundEvent) {
            if (!refund?.id || !refund?.payment_id) {
                throw new AppError('Razorpay refund webhook is missing its refund or payment ID.', StatusCodes.BAD_REQUEST);
            }
            const paymentAttempt = await PaymentAttempt.findOne({
                where: { providerPaymentId: refund.payment_id },
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            if (paymentAttempt) {
                const notedAttemptId = Number(refund.notes?.refundAttemptId);
                let refundAttempt = Number.isInteger(notedAttemptId)
                    ? await RefundAttempt.findOne({
                        where: { id: notedAttemptId, paymentAttemptId: paymentAttempt.id },
                        transaction,
                        lock: transaction.LOCK.UPDATE,
                    })
                    : null;
                if (!refundAttempt) {
                    refundAttempt = await RefundAttempt.findOne({
                        where: { paymentAttemptId: paymentAttempt.id, providerRefundId: refund.id },
                        transaction,
                        lock: transaction.LOCK.UPDATE,
                    });
                }
                if (refundAttempt) {
                    if (Number(refund.amount) !== Number(refundAttempt.amount) || refund.currency !== refundAttempt.currency) {
                        throw new AppError('Razorpay refund webhook does not match the saved refund amount or currency.', StatusCodes.CONFLICT);
                    }
                    const status = event.event === 'refund.processed' || refund.status === 'processed'
                        ? 'processed'
                        : event.event === 'refund.failed' || refund.status === 'failed' ? 'failed' : 'pending';
                    if (refundStatusPriority[status] >= refundStatusPriority[refundAttempt.status]) {
                        await refundAttempt.update({ status, providerRefundId: refund.id }, { transaction });
                    }
                    eventStatus = 'processed';
                }
            }
        }

        await db.PaymentWebhookEvent.create({
            eventId,
            eventType: event.event || 'unknown',
            providerPaymentId: payment?.id || null,
            providerOrderId: payment?.order_id || null,
            status: eventStatus,
        }, { transaction });
        await transaction.commit();
    } catch (error) {
        if (!transaction.finished) await transaction.rollback();
        if (error.name === 'SequelizeUniqueConstraintError') {
            const duplicate = await db.PaymentWebhookEvent.findOne({ where: { eventId } });
            if (duplicate) return { duplicate: true, status: duplicate.status };
        }
        if (error instanceof AppError) throw error;
        throw new AppError('Could not process Razorpay webhook. It can be retried.', StatusCodes.INTERNAL_SERVER_ERROR);
    }

    if (notify && booking) {
        const primaryPassenger = booking.passengerDetails?.[0];
        if (primaryPassenger?.email) {
            const passengerNames = booking.passengerDetails.map(({ fullName }) => fullName).join(', ');
            try {
                await queue.sendData({
                    text: `Your SkyLink booking ${booking.id} is confirmed. Flight: ${booking.flightId}. Passengers: ${passengerNames}. Total: ${booking.totalCost}.`,
                    subject: `Booking ${booking.id} confirmed`,
                    recepientEmail: primaryPassenger.email,
                });
            } catch (notificationError) {
                logger.error(`Could not queue booking confirmation email: ${notificationError.message}`);
            }
        }
    }
    return { duplicate: false, status: 'processed' };
}

async function createRazorpayOrder({ bookingId, userId, idempotencyKey }) {
    if (!serverConfig.RAZORPAY_KEY_ID || !serverConfig.RAZORPAY_KEY_SECRET) {
        throw new AppError('Razorpay API credentials are not configured in Booking Service.', StatusCodes.SERVICE_UNAVAILABLE);
    }

    const transaction = await db.sequelize.transaction();
    let attempt;
    try {
        const booking = await bookingRepo.get(bookingId, transaction, true);
        if (Number(booking.userId) !== Number(userId)) {
            throw new AppError('Booking not found.', StatusCodes.NOT_FOUND);
        }
        if (booking.status !== INITIATED) {
            throw new AppError('This booking is not awaiting payment.', StatusCodes.CONFLICT);
        }
        if (Date.now() - new Date(booking.createdAt).getTime() > 300000) {
            throw new AppError('The booking hold has expired.', StatusCodes.CONFLICT);
        }

        const existing = await PaymentAttempt.findOne({ where: { idempotencyKey }, transaction });
        if (existing) {
            if (Number(existing.bookingId) !== Number(bookingId) || Number(existing.amount) !== Number(booking.totalCost) * 100) {
                throw new AppError('This idempotency key was already used for a different payment order.', StatusCodes.CONFLICT);
            }
            if (existing.status === 'created' && existing.providerOrderId) {
                await transaction.commit();
                return {
                    paymentAttemptId: existing.id,
                    razorpayOrderId: existing.providerOrderId,
                    amount: existing.amount,
                    currency: existing.currency,
                    keyId: serverConfig.RAZORPAY_KEY_ID,
                };
            }
            throw new AppError('This payment order attempt is not reusable. Start a new attempt.', StatusCodes.CONFLICT);
        }

        const activeAttempt = await PaymentAttempt.findOne({
            where: { bookingId, status: ['creating', 'created', 'authorized'] },
            transaction,
        });
        if (activeAttempt) {
            if (activeAttempt.status === 'created' && activeAttempt.providerOrderId) {
                await transaction.commit();
                return {
                    paymentAttemptId: activeAttempt.id,
                    razorpayOrderId: activeAttempt.providerOrderId,
                    amount: activeAttempt.amount,
                    currency: activeAttempt.currency,
                    keyId: serverConfig.RAZORPAY_KEY_ID,
                };
            }
            throw new AppError(activeAttempt.status === 'authorized'
                ? 'Payment authorization is still being processed. Wait for its final status before retrying.'
                : 'A payment order is already being created for this booking. Retry shortly.', StatusCodes.CONFLICT);
        }

        if (!Number.isSafeInteger(Number(booking.totalCost)) || Number(booking.totalCost) < 1) {
            throw new AppError('The booking fare is invalid.', StatusCodes.UNPROCESSABLE_ENTITY);
        }
        const amount = Number(booking.totalCost) * 100;
        if (!Number.isSafeInteger(amount)) {
            throw new AppError('The booking fare is outside the supported payment range.', StatusCodes.UNPROCESSABLE_ENTITY);
        }
        const receipt = `skylink-${booking.id}-${Date.now()}`.slice(0, 40);
        attempt = await PaymentAttempt.create({
            bookingId: booking.id,
            amount,
            currency: serverConfig.RAZORPAY_CURRENCY,
            status: 'creating',
            idempotencyKey,
            receipt,
        }, { transaction });
        await transaction.commit();
    } catch (error) {
        if (!transaction.finished) await transaction.rollback();
        throw error;
    }

    try {
        const response = await axios.post('https://api.razorpay.com/v1/orders', {
            amount: attempt.amount,
            currency: attempt.currency,
            receipt: attempt.receipt,
            notes: { bookingId: String(attempt.bookingId), paymentAttemptId: String(attempt.id) },
        }, {
            auth: {
                username: serverConfig.RAZORPAY_KEY_ID,
                password: serverConfig.RAZORPAY_KEY_SECRET,
            },
            timeout: 10000,
        });
        await attempt.update({ providerOrderId: response.data.id, status: 'created' });
        return {
            paymentAttemptId: attempt.id,
            razorpayOrderId: response.data.id,
            amount: attempt.amount,
            currency: attempt.currency,
            keyId: serverConfig.RAZORPAY_KEY_ID,
        };
    } catch (error) {
        await attempt.update({ status: 'failed' });
        throw new AppError('Razorpay could not create the payment order. Start a new payment attempt or contact support if the result is unclear.', StatusCodes.BAD_GATEWAY);
    }
}

async function withFlightDetails(booking) {
    try {
        const response = await axios.get(`${serverConfig.FLIGHT_SERVICE}/api/v1/flights/${booking.flightId}`);
        return { ...booking.toJSON(), flight: response.data.data || null };
    } catch {
        return { ...booking.toJSON(), flight: null };
    }
}

async function withRefundDetails(booking) {
    const data = await withFlightDetails(booking);
    const refund = await RefundAttempt.findOne({
        where: { bookingId: booking.id },
        order: [['attemptNumber', 'DESC']],
    });
    return {
        ...data,
        refund: refund ? {
            status: refund.status,
            amount: refund.amount,
            currency: refund.currency,
            reason: refund.reason,
        } : null,
    };
}

async function getCustomerBookings(userId) {
    const bookings = await bookingRepo.getForCustomer(userId);
    return Promise.all(bookings.map(withFlightDetails));
}

async function getAllBookings() {
    return bookingRepo.getAllForAdmin();
}

async function getCustomerBooking(bookingId, userId) {
    const booking = await bookingRepo.get(bookingId);
    if (Number(booking.userId) !== Number(userId)) {
        throw new AppError('Booking not found', StatusCodes.NOT_FOUND);
    }
    return withRefundDetails(booking);
}

async function cancelCustomerBooking(bookingId, userId) {
    const booking = await bookingRepo.get(bookingId);
    if (Number(booking.userId) !== Number(userId)) {
        throw new AppError('Booking not found', StatusCodes.NOT_FOUND);
    }
    const paymentAttempt = await PaymentAttempt.findOne({
        where: { bookingId: booking.id, status: ['captured', 'late_capture'] },
        order: [['createdAt', 'DESC']],
    });
    let latestRefund = null;

    if (booking.status === CANCELLED) {
        latestRefund = paymentAttempt && await RefundAttempt.findOne({
            where: { paymentAttemptId: paymentAttempt.id },
            order: [['attemptNumber', 'DESC']],
        });
        if (!paymentAttempt || latestRefund?.status !== 'failed') return withRefundDetails(booking);
    } else {
        const flightResponse = await axios.get(`${serverConfig.FLIGHT_SERVICE}/api/v1/flights/${booking.flightId}`);
        const flight = flightResponse.data.data;
        if (!flight || !Number.isFinite(Date.parse(flight.departureTime)) || Date.parse(flight.departureTime) <= Date.now()) {
            throw new AppError('This flight has already departed or its schedule is unavailable.', StatusCodes.CONFLICT);
        }
    }

    if (paymentAttempt && [BOOKED, CANCELLED].includes(booking.status)) {
        const refundAttempt = await ensureRefundAttempt({
            bookingId: booking.id,
            paymentAttemptId: paymentAttempt.id,
            reason: booking.status === CANCELLED ? latestRefund.reason : 'cancellation',
        });
        const refund = await requestRazorpayRefund(refundAttempt);
        if (refund.status === 'failed') {
            throw new AppError('Razorpay could not complete the refund. The refund status is recorded for retry.', StatusCodes.CONFLICT);
        }
    }

    if (booking.status !== CANCELLED) await cancelBooking(booking.id);
    return withRefundDetails(await bookingRepo.get(booking.id));
}

async function cancelBooking(bookingId, onlyIfUnpaid = false) {
    const transaction = await db.sequelize.transaction();
    try {
        const bookingDetails = await bookingRepo.get(bookingId, transaction, true);
        if(bookingDetails.status == CANCELLED) {
            await transaction.commit();
            return true;
        }
        if (onlyIfUnpaid && ![INITIATED, enums.BOOKING_STATUS.PENDING].includes(bookingDetails.status)) {
            await transaction.commit();
            return bookingDetails;
        }
        await axios.patch(`${serverConfig.FLIGHT_SERVICE}/api/v1/flights/${bookingDetails.flightId}/seats`, {
            seats: bookingDetails.noOfSeats,
            dec: 0,
            operationId: `booking-release-${bookingDetails.id}`,
            ...(bookingDetails.idempotencyKey ? { compensatesOperationId: `booking-hold-${bookingDetails.idempotencyKey}` } : {}),
        });
        await bookingRepo.update(bookingId, {status: CANCELLED}, transaction);
        await transaction.commit();
        return bookingRepo.get(bookingId);

    } catch(error) {
        await transaction.rollback();
        throw error;
    }
}

async function cancelOldBookings() {
    try {
        const time = new Date( Date.now() - 1000 * 300 ); // time 5 mins ago
        const expiredBookings = await bookingRepo.getExpiredBookings(time);
        const outcomes = await Promise.allSettled(expiredBookings.map(({ id }) => cancelBooking(id, true)));
        return { processed: outcomes.length, failed: outcomes.filter(({ status }) => status === 'rejected').length };
    } catch(error) {
        console.error('Could not reconcile expired bookings', error);
        throw error;
    }
}

module.exports = {
  createBooking,
  createRazorpayOrder,
  verifyRazorpayPayment,
  processRazorpayWebhook,
  getCustomerBookings,
  getAllBookings,
  getCustomerBooking,
  cancelCustomerBooking,
  processQueuedRefundAttempts,
 
  cancelOldBookings
 

};
