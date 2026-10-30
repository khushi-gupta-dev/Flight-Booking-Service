'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class RebookingAttempt extends Model {}

  RebookingAttempt.init({
    recoveryCaseId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
    idempotencyKey: { type: DataTypes.STRING(160), allowNull: false, unique: true },
    status: {
      type: DataTypes.ENUM('created', 'replacement_hold_pending', 'replacement_held', 'booking_updated', 'old_seat_release_pending', 'completed', 'failed'),
      allowNull: false,
      defaultValue: 'created',
    },
    replacementHoldOperationId: { type: DataTypes.STRING(160), allowNull: false },
    oldSeatReleaseOperationId: { type: DataTypes.STRING(160), allowNull: false },
    previousFlightId: { type: DataTypes.INTEGER, allowNull: false },
    replacementFlightId: { type: DataTypes.INTEGER, allowNull: false },
    lastStep: { type: DataTypes.STRING(60), allowNull: true },
    errorMessage: { type: DataTypes.STRING(500), allowNull: true },
  }, {
    sequelize,
    modelName: 'RebookingAttempt',
  });

  return RebookingAttempt;
};
