'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('PaymentAttempts', 'providerPaymentId', {
      type: Sequelize.STRING(64),
      allowNull: true,
      unique: true,
    });
    await queryInterface.changeColumn('PaymentAttempts', 'status', {
      type: Sequelize.ENUM('creating', 'created', 'authorized', 'captured', 'failed', 'late_capture'),
      allowNull: false,
      defaultValue: 'creating',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('PaymentAttempts', 'status', {
      type: Sequelize.ENUM('creating', 'created', 'failed'),
      allowNull: false,
      defaultValue: 'creating',
    });
    await queryInterface.removeColumn('PaymentAttempts', 'providerPaymentId');
  },
};
