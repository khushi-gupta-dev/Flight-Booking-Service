'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class RecoveryAuditEvent extends Model {}

  RecoveryAuditEvent.init({
    aggregateType: { type: DataTypes.STRING(40), allowNull: false },
    aggregateId: { type: DataTypes.STRING(80), allowNull: false },
    eventType: { type: DataTypes.STRING(80), allowNull: false },
    actorType: { type: DataTypes.STRING(24), allowNull: false },
    actorId: { type: DataTypes.STRING(80), allowNull: true },
    correlationId: { type: DataTypes.STRING(120), allowNull: false },
    payload: { type: DataTypes.JSON, allowNull: false },
  }, {
    sequelize,
    modelName: 'RecoveryAuditEvent',
  });

  return RecoveryAuditEvent;
};
