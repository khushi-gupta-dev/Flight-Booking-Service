'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class RecoveryCase extends Model {
    static associate(models) {
      this.belongsTo(models.Booking, { foreignKey: 'bookingId', as: 'booking' });
      this.hasMany(models.RecoveryAlternative, { foreignKey: 'recoveryCaseId', as: 'alternatives' });
      this.hasOne(models.RebookingAttempt, { foreignKey: 'recoveryCaseId', as: 'rebookingAttempt' });
    }
  }

  RecoveryCase.init({
    disruptionId: { type: DataTypes.INTEGER, allowNull: false },
    bookingId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    selectedAlternativeId: { type: DataTypes.INTEGER, allowNull: true },
    status: {
      type: DataTypes.ENUM('created', 'awaiting_alternatives', 'awaiting_approval', 'declined', 'rebooking', 'completed', 'failed'),
      allowNull: false,
      defaultValue: 'created',
    },
    expiresAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    sequelize,
    modelName: 'RecoveryCase',
    indexes: [{ unique: true, fields: ['disruptionId', 'bookingId'] }],
  });

  return RecoveryCase;
};
