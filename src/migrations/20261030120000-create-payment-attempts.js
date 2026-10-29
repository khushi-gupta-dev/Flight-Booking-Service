'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('PaymentAttempts', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      bookingId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Bookings', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      provider: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'razorpay' },
      providerOrderId: { type: Sequelize.STRING(64), allowNull: true, unique: true },
      amount: { type: Sequelize.INTEGER, allowNull: false },
      currency: { type: Sequelize.STRING(3), allowNull: false },
      status: { type: Sequelize.ENUM('creating', 'created', 'failed'), allowNull: false, defaultValue: 'creating' },
      idempotencyKey: { type: Sequelize.STRING(120), allowNull: false, unique: true },
      receipt: { type: Sequelize.STRING(40), allowNull: false, unique: true },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('PaymentAttempts');
  },
};
