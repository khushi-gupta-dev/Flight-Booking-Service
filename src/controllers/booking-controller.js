const { bookingService } = require("../services");
const { successResponse, errorResponse } = require("../utils/common");
const { StatusCodes } = require("http-status-codes");
async function createBooking(req, res) {
  try {
    
    const response = await bookingService.createBooking({
      flightId: req.body.flightId,
      userId: req.body.userId,
      noOfSeats : req.body.noOfSeats
    });

    successResponse.data = response;
    return res
      .status(StatusCodes.OK)
      .json(successResponse);
  } catch (error) {

    errorResponse.error = error;
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json(errorResponse);
  }
}

async function makePayment(req, res) {
    try {
        const response = await bookingService.makePayment({
            totalCost: req.body.totalCost,
            userId: req.body.userId,
            bookingId: req.body.bookingId
        });
        successResponse.data = response;
        return res
                .status(StatusCodes.OK)
                .json(successResponse);
    } catch (error) {
       errorResponse.error = error;
        return res
                .status(StatusCodes.INTERNAL_SERVER_ERROR)
                .json(errorResponse);
    }
}
module.exports = {
  createBooking,
  makePayment
};
