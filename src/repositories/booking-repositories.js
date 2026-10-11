const { StatusCodes } = require('http-status-codes');
const { Op } = require("sequelize");
const AppError = require('../utils/errors/app-error');
const CrudRepository = require('./crud-repository');
const { Booking } = require('../models');
const {enums} = require('../utils/common');
const { CANCELLED, BOOKED } = enums.BOOKING_STATUS;
class bookingRepository extends CrudRepository {
    constructor() {
        super(Booking);
    }


    async createBooking(data, transaction) {
        const response = await Booking.create(data, {transaction: transaction});
        return response;
    } 

     async get(data, transaction, lock = false) {
        const response = await Booking.findByPk(data, {
            transaction,
            ...(transaction && lock ? { lock: transaction.LOCK.UPDATE } : {}),
        });
        if(!response) {
            throw new AppError('Not able to find the resource', StatusCodes.NOT_FOUND);
        }
        return response;
    }

    async getForCustomer(userId) {
        return Booking.findAll({
            where: { userId },
            order: [['createdAt', 'DESC']],
        });
    }

    async getAllForAdmin() {
        return Booking.findAll({ order: [['createdAt', 'DESC']] });
    }

    async update(id, data, transaction) { // data -> {col: value, ....}
        const response = await Booking.update(data, {
            where: {
                id: id
            },
            transaction,
        });
        return response;
    }

    async getExpiredBookings(timestamp) {
        return Booking.findAll({
            where: {
                createdAt: { [Op.lt]: timestamp },
                status: { [Op.notIn]: [BOOKED, CANCELLED] },
            },
            attributes: ['id'],
            order: [['createdAt', 'ASC']],
        });
    }
}

module.exports = bookingRepository;
