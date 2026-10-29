'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('PaymentWebhookEvents', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      eventId: { type: Sequelize.STRING(128), allowNull: false, unique: true },
      eventType: { type: Sequelize.STRING(64), allowNull: false },
      providerPaymentId: { type: Sequelize.STRING(64), allowNull: true },
      providerOrderId: { type: Sequelize.STRING(64), allowNull: true },
      status: { type: Sequelize.STRING(16), allowNull: false },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('PaymentWebhookEvents');
  },
};
