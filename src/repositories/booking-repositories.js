const {StatusCodes} = require('http-status-codes');
const AppError = require('../utils/errors/app-error');
const CrudRepository = require('./crud-repository');
const { Booking } = require('../models');

class bookingRepository extends CrudRepository {
    constructor() {
        super(Booking);
    }


    async createBooking(data, transaction) {
        const response = await Booking.create(data, {transaction: transaction});
        return response;
    } 
}

module.exports = bookingRepository;