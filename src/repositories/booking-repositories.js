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

     async get(data, transaction) {
        const response = await this.model.findByPk(data, {transaction: transaction});
        if(!response) {
            throw new AppError('Not able to fund the resource', StatusCodes.NOT_FOUND);
        }
        return response;
    }

    async update(id, data, transaction) { // data -> {col: value, ....}
        const response = await this.model.update(data, {
            where: {
                id: id
            }
        }, {transaction: transaction});
        return response;
    }
}

module.exports = bookingRepository;