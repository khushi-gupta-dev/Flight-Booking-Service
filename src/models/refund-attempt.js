'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class RefundAttempt extends Model {}

  RefundAttempt.init({
    bookingId: { type: DataTypes.INTEGER, allowNull: false },
    paymentAttemptId: { type: DataTypes.INTEGER, allowNull: false },
    provider: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'razorpay' },
    providerRefundId: { type: DataTypes.STRING(64), allowNull: true, unique: true },
    amount: { type: DataTypes.INTEGER, allowNull: false },
    currency: { type: DataTypes.STRING(3), allowNull: false },
    reason: { type: DataTypes.ENUM('cancellation', 'late_capture'), allowNull: false },
    status: { type: DataTypes.ENUM('queued', 'pending', 'processed', 'failed'), allowNull: false, defaultValue: 'queued' },
    idempotencyKey: { type: DataTypes.STRING(80), allowNull: false, unique: true },
    receipt: { type: DataTypes.STRING(40), allowNull: false, unique: true },
    attemptNumber: { type: DataTypes.INTEGER, allowNull: false },
  }, {
    sequelize,
    modelName: 'RefundAttempt',
    indexes: [{ unique: true, fields: ['paymentAttemptId', 'attemptNumber'] }],
  });

  return RefundAttempt;
};
