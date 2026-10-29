'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PaymentWebhookEvent extends Model {}

  PaymentWebhookEvent.init({
    eventId: { type: DataTypes.STRING(128), allowNull: false, unique: true },
    eventType: { type: DataTypes.STRING(64), allowNull: false },
    providerPaymentId: { type: DataTypes.STRING(64), allowNull: true },
    providerOrderId: { type: DataTypes.STRING(64), allowNull: true },
    status: { type: DataTypes.STRING(16), allowNull: false },
  }, { sequelize, modelName: 'PaymentWebhookEvent' });

  return PaymentWebhookEvent;
};
