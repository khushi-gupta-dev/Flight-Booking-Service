'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('RefundAttempts', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      bookingId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Bookings', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      paymentAttemptId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'PaymentAttempts', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      provider: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'razorpay' },
      providerRefundId: { type: Sequelize.STRING(64), allowNull: true, unique: true },
      amount: { type: Sequelize.INTEGER, allowNull: false },
      currency: { type: Sequelize.STRING(3), allowNull: false },
      reason: { type: Sequelize.ENUM('cancellation', 'late_capture'), allowNull: false },
      status: { type: Sequelize.ENUM('queued', 'pending', 'processed', 'failed'), allowNull: false, defaultValue: 'queued' },
      idempotencyKey: { type: Sequelize.STRING(80), allowNull: false, unique: true },
      receipt: { type: Sequelize.STRING(40), allowNull: false, unique: true },
      attemptNumber: { type: Sequelize.INTEGER, allowNull: false },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex('RefundAttempts', ['paymentAttemptId', 'attemptNumber'], { unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('RefundAttempts');
  },
};
