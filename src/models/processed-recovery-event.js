'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ProcessedRecoveryEvent extends Model {}

  ProcessedRecoveryEvent.init({
    eventId: { type: DataTypes.STRING(120), allowNull: false, unique: true },
    eventType: { type: DataTypes.STRING(80), allowNull: false },
    correlationId: { type: DataTypes.STRING(120), allowNull: false },
  }, {
    sequelize,
    modelName: 'ProcessedRecoveryEvent',
  });

  return ProcessedRecoveryEvent;
};
