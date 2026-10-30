'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class RecoveryAlternative extends Model {
    static associate(models) {
      this.belongsTo(models.RecoveryCase, { foreignKey: 'recoveryCaseId', as: 'recoveryCase' });
    }
  }

  RecoveryAlternative.init({
    recoveryCaseId: { type: DataTypes.INTEGER, allowNull: false },
    replacementFlightId: { type: DataTypes.INTEGER, allowNull: false },
    departureTime: { type: DataTypes.DATE, allowNull: false },
    arrivalTime: { type: DataTypes.DATE, allowNull: false },
    price: { type: DataTypes.INTEGER, allowNull: false },
    availableSeats: { type: DataTypes.INTEGER, allowNull: false },
    score: { type: DataTypes.DECIMAL(8, 4), allowNull: false },
    explanation: { type: DataTypes.STRING(500), allowNull: false },
    status: {
      type: DataTypes.ENUM('available', 'expired', 'selected', 'unavailable'),
      allowNull: false,
      defaultValue: 'available',
    },
  }, {
    sequelize,
    modelName: 'RecoveryAlternative',
    indexes: [{ unique: true, fields: ['recoveryCaseId', 'replacementFlightId'] }],
  });

  return RecoveryAlternative;
};
