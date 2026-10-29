const { bookingService } = require("../services");
const { StatusCodes } = require("http-status-codes");
const inMemDb = new Map();

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

async function makePayment(req, res) {
  try {
      
     const idempotencyKey = req.headers['x-idempotency-key'];
        if(!idempotencyKey ) {
            return res
                .status(StatusCodes.BAD_REQUEST)
                .json({message: 'idempotency key missing'});
        }
        const request = {
            totalCost: req.body.totalCost,
            userId: Number(req.headers['x-user-id']),
            bookingId: Number(req.body.bookingId),
        };
        const priorPayment = inMemDb.get(idempotencyKey);
        if (priorPayment && (priorPayment.bookingId !== request.bookingId || priorPayment.userId !== request.userId || priorPayment.totalCost !== request.totalCost)) {
            return res.status(StatusCodes.CONFLICT).json({ success: false, message: 'This idempotency key was already used for a different payment request.' });
        }
        if(priorPayment) {
            return res
                .status(StatusCodes.OK)
                .json({ success: true, message: 'Payment already processed.', data: priorPayment.response, error: {} });
    } 
    
        const response = await bookingService.makePayment(request);
    
     inMemDb.set(idempotencyKey, { ...request, response });
    
        return res.status(StatusCodes.OK).json({
            success: true,
            message: 'Payment completed.',
            data: response,
            error: {},
        });
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
  makePayment
};
