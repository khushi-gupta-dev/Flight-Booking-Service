const { bookingService } = require("../services");
const { StatusCodes } = require("http-status-codes");

function authenticatedUserId(req, res) {
  const userId = Number(req.headers['x-user-id']);
  if (!Number.isInteger(userId) || userId < 1) {
    res.status(StatusCodes.UNAUTHORIZED).json({ success: false, message: 'Sign in to access your bookings.' });
    return null;
  }
  return userId;
}

function sendError(res, error) {
  return res.status(error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: error.message || 'The booking service could not complete this request.',
    error: { message: error.message || 'Unexpected error.' },
  });
}

function validBookingId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'A valid booking ID is required.' });
    return null;
  }
  return id;
}

async function getCustomerBookings(req, res) {
  const userId = authenticatedUserId(req, res);
  if (!userId) return;
  try {
    const data = await bookingService.getCustomerBookings(userId);
    return res.status(StatusCodes.OK).json({ success: true, message: 'Bookings retrieved.', data });
  } catch (error) { return sendError(res, error); }
}

async function getAllBookings(req, res) {
  try {
    const data = await bookingService.getAllBookings();
    return res.status(StatusCodes.OK).json({ success: true, message: 'All bookings retrieved.', data });
  } catch (error) { return sendError(res, error); }
}

async function getCustomerBooking(req, res) {
  const userId = authenticatedUserId(req, res);
  if (!userId) return;
  const id = validBookingId(req, res);
  if (!id) return;
  try {
    const data = await bookingService.getCustomerBooking(id, userId);
    return res.status(StatusCodes.OK).json({ success: true, message: 'Booking retrieved.', data });
  } catch (error) { return sendError(res, error); }
}

async function cancelCustomerBooking(req, res) {
  const userId = authenticatedUserId(req, res);
  if (!userId) return;
  const id = validBookingId(req, res);
  if (!id) return;
  try {
    const data = await bookingService.cancelCustomerBooking(id, userId);
    return res.status(StatusCodes.OK).json({ success: true, message: 'Booking cancelled.', data });
  } catch (error) { return sendError(res, error); }
}

async function createBooking(req, res) {
  try {
    const idempotencyKey = req.headers['x-idempotency-key'];
    if (typeof idempotencyKey !== 'string' || !/^[a-zA-Z0-9._:-]{8,120}$/.test(idempotencyKey)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: 'A valid X-Idempotency-Key header is required for booking creation.',
      });
    }
    const noOfSeats = Number(req.body.noOfSeats)
    const passengerDetails = req.body.passengerDetails
    if (!Number.isInteger(noOfSeats) || noOfSeats < 1 || !Array.isArray(passengerDetails) || passengerDetails.length !== noOfSeats) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: 'Provide passenger details for every booked seat.',
        error: { message: 'Passenger count must match noOfSeats.' },
      })
    }

    const normalizedPassengers = passengerDetails.map((passenger) => ({
      fullName: String(passenger?.fullName || '').trim(),
      email: String(passenger?.email || '').trim().toLowerCase(),
      phone: String(passenger?.phone || '').trim(),
    }))
    const invalidPassenger = normalizedPassengers.some(({ fullName, email, phone }) =>
      !fullName || fullName.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[+\d][\d\s()-]{6,19}$/.test(phone),
    )
    if (invalidPassenger) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: 'Check each passenger name, email address, and phone number.',
        error: { message: 'Passenger details are invalid.' },
      })
    }

    const response = await bookingService.createBooking({
      flightId: req.body.flightId,
      userId: Number(req.headers['x-user-id']),
      noOfSeats,
      passengerDetails: normalizedPassengers,
      idempotencyKey,
    });

    return res.status(StatusCodes.OK).json({
      success: true,
      message: 'Booking initiated.',
      data: response,
      error: {},
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function createPaymentOrder(req, res) {
  const userId = authenticatedUserId(req, res);
  if (!userId) return;
  const bookingId = Number(req.body.bookingId);
  const idempotencyKey = req.headers['x-idempotency-key'];
  if (!Number.isInteger(bookingId) || bookingId < 1) {
    return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'A valid bookingId is required.' });
  }
  if (typeof idempotencyKey !== 'string' || !/^[a-zA-Z0-9._:-]{8,120}$/.test(idempotencyKey)) {
    return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'A valid X-Idempotency-Key header is required.' });
  }
  try {
    const data = await bookingService.createRazorpayOrder({ bookingId, userId, idempotencyKey });
    return res.status(StatusCodes.CREATED).json({ success: true, message: 'Payment order created.', data });
  } catch (error) {
    return sendError(res, error);
  }
}

async function verifyRazorpayPayment(req, res) {
  const userId = authenticatedUserId(req, res);
  if (!userId) return;
  const bookingId = Number(req.params.id);
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
  if (!Number.isInteger(bookingId) || bookingId < 1) {
    return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'A valid booking ID is required.' });
  }
  if (typeof orderId !== 'string' || !/^order_[a-zA-Z0-9]+$/.test(orderId)
    || typeof paymentId !== 'string' || !/^pay_[a-zA-Z0-9]+$/.test(paymentId)
    || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) {
    return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'Razorpay order, payment, or signature details are invalid.' });
  }
  try {
    const data = await bookingService.verifyRazorpayPayment({ bookingId, userId, orderId, paymentId, signature });
    if (data.status === 'captured') {
      return res.status(StatusCodes.OK).json({ success: true, message: 'Payment captured and booking confirmed.', data });
    }
    if (data.status === 'late_capture') {
      return res.status(StatusCodes.CONFLICT).json({ success: false, message: 'Payment was captured after the booking hold expired. It needs refund reconciliation.', data });
    }
    if (data.status === 'failed') {
      return res.status(StatusCodes.CONFLICT).json({ success: false, message: 'Payment failed. You may start a new payment attempt.', data });
    }
    return res.status(StatusCodes.ACCEPTED).json({ success: true, message: 'Payment is not captured yet; check again shortly.', data });
  } catch (error) {
    return sendError(res, error);
  }
}

async function receiveRazorpayWebhook(req, res) {
  try {
    const result = await bookingService.processRazorpayWebhook({
      rawBody: req.body,
      signature: req.get('x-razorpay-signature'),
      eventId: req.get('x-razorpay-event-id'),
    });
    return res.status(StatusCodes.OK).json({ success: true, message: 'Webhook accepted.', data: result });
  } catch (error) {
    return sendError(res, error);
  }
}

module.exports = {
  getCustomerBookings,
  getAllBookings,
  getCustomerBooking,
  cancelCustomerBooking,
  createBooking,
  createPaymentOrder,
  verifyRazorpayPayment,
  receiveRazorpayWebhook,
};
