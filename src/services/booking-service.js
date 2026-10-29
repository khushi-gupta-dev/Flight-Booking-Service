const axios = require("axios");
const {StatusCodes} = require("http-status-codes")
const AppError = require("../utils/errors/app-error");
const { bookingRepository } = require("../repositories");
const {serverConfig,queue} = require("../config");
const db = require("../models");
const {enums} = require('../utils/common');
const { BOOKED, CANCELLED, INITIATED } = enums.BOOKING_STATUS;
const bookingRepo = new bookingRepository();

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
  
async function makePayment(data) {
    const transaction = await db.sequelize.transaction();
    try {
        const bookingDetails = await bookingRepo.get(data.bookingId, transaction, true);
        if(bookingDetails.userId != data.userId) {
            throw new AppError('The user corresponding to the booking doesnt match', StatusCodes.BAD_REQUEST);
        }
        if(bookingDetails.totalCost != data.totalCost) {
            throw new AppError('The amount of the payment doesnt match', StatusCodes.BAD_REQUEST);
        }
        if (bookingDetails.status === BOOKED) {
            await transaction.commit();
            return true;
        }
        if(bookingDetails.status == CANCELLED) {
            throw new AppError('The booking has expired', StatusCodes.BAD_REQUEST);
        }
        if (bookingDetails.status !== INITIATED) {
            throw new AppError('This booking is not awaiting payment.', StatusCodes.CONFLICT);
        }
        const bookingTime = new Date(bookingDetails.createdAt);
        const currentTime = new Date();
        if(currentTime - bookingTime > 300000) {
            await transaction.rollback();
            await cancelBooking(data.bookingId);
            throw new AppError('The booking has expired', StatusCodes.BAD_REQUEST);
        }
        // we assume here that payment is successful
         await bookingRepo.update(data.bookingId, {status: BOOKED}, transaction);
        await transaction.commit();

        const primaryPassenger = bookingDetails.passengerDetails?.[0];
        if (primaryPassenger?.email) {
            const passengerNames = bookingDetails.passengerDetails.map((passenger) => passenger.fullName).join(", ");
            try {
                await queue.sendData({
                    text: `Your SkyLink booking ${bookingDetails.id} is confirmed. Flight: ${bookingDetails.flightId}. Passengers: ${passengerNames}. Total: ${bookingDetails.totalCost}.`,
                    subject: `Booking ${bookingDetails.id} confirmed`,
                    recepientEmail: primaryPassenger.email
                });
            } catch (notificationError) {
                console.error("Could not queue booking confirmation email", notificationError);
            }
        }
        return true;

    } catch(error) {
        if (!transaction.finished) await transaction.rollback();
        throw error;
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
    return withFlightDetails(booking);
}

async function cancelCustomerBooking(bookingId, userId) {
    const booking = await getCustomerBooking(bookingId, userId);
    if (booking.status === CANCELLED) return booking;
    const flightResponse = await axios.get(`${serverConfig.FLIGHT_SERVICE}/api/v1/flights/${booking.flightId}`);
    const flight = flightResponse.data.data;
    if (!flight || !Number.isFinite(Date.parse(flight.departureTime)) || Date.parse(flight.departureTime) <= Date.now()) {
        throw new AppError('This flight has already departed or its schedule is unavailable.', StatusCodes.CONFLICT);
    }
    await cancelBooking(booking.id);
    return withFlightDetails(await bookingRepo.get(booking.id));
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
  makePayment,
  getCustomerBookings,
  getAllBookings,
  getCustomerBooking,
  cancelCustomerBooking,
 
  cancelOldBookings
 

};
