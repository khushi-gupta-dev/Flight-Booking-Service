'use strict';

/** @type {import('sequelize-cli').Migration} */
const { enums } = require('../utils/common');

const { BOOKED, CANCELLED ,INITIATED , PENDING} = enums.BOOKING_STATUS;
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Bookings', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      flightId: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      status: {
        type: Sequelize.ENUM,
        allowNull: false,
      values: [BOOKED, CANCELLED, INITIATED, PENDING],
        defaultValue: 'initiated'
      },
      totalCost: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      noOfSeats: {
        type: Sequelize.INTEGER,         // no. of seats requested by the user to book
        allowNull: false,
        defaultValue: 1
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('Bookings');
  }
};