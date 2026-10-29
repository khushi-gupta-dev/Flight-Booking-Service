'use strict';

const { enums } = require('../utils/common');
const { BOOKED, CANCELLED, CANCELLATION_REQUESTED, INITIATED, PENDING } = enums.BOOKING_STATUS;

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('Bookings', 'status', {
      type: Sequelize.ENUM(BOOKED, CANCELLED, CANCELLATION_REQUESTED, INITIATED, PENDING),
      allowNull: false,
      defaultValue: INITIATED,
    });

    await queryInterface.sequelize.query(`
      UPDATE Bookings
      SET status = '${CANCELLATION_REQUESTED}'
      WHERE status = '${BOOKED}'
        AND id IN (
          SELECT bookingId FROM RefundAttempts
          WHERE reason = 'cancellation' AND status IN ('queued', 'pending', 'failed')
        )
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      UPDATE Bookings
      SET status = '${BOOKED}'
      WHERE status = '${CANCELLATION_REQUESTED}'
    `);
    await queryInterface.changeColumn('Bookings', 'status', {
      type: Sequelize.ENUM(BOOKED, CANCELLED, INITIATED, PENDING),
      allowNull: false,
      defaultValue: INITIATED,
    });
  },
};
