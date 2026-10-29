'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PaymentAttempt extends Model {}

  PaymentAttempt.init({
    bookingId: { type: DataTypes.INTEGER, allowNull: false },
    provider: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'razorpay' },
    providerOrderId: { type: DataTypes.STRING(64), allowNull: true, unique: true },
    providerPaymentId: { type: DataTypes.STRING(64), allowNull: true, unique: true },
    amount: { type: DataTypes.INTEGER, allowNull: false },
    currency: { type: DataTypes.STRING(3), allowNull: false },
    status: { type: DataTypes.ENUM('creating', 'created', 'authorized', 'captured', 'failed', 'late_capture'), allowNull: false, defaultValue: 'creating' },
    idempotencyKey: { type: DataTypes.STRING(120), allowNull: false, unique: true },
    receipt: { type: DataTypes.STRING(40), allowNull: false, unique: true },
  }, { sequelize, modelName: 'PaymentAttempt' });

  return PaymentAttempt;
};
