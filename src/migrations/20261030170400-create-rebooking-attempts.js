'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('RebookingAttempts', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      recoveryCaseId: { allowNull: false, unique: true, type: Sequelize.INTEGER },
      idempotencyKey: { allowNull: false, unique: true, type: Sequelize.STRING(160) },
      status: {
        allowNull: false,
        defaultValue: 'created',
        type: Sequelize.ENUM('created', 'replacement_hold_pending', 'replacement_held', 'booking_updated', 'old_seat_release_pending', 'completed', 'failed'),
      },
      replacementHoldOperationId: { allowNull: false, type: Sequelize.STRING(160) },
      oldSeatReleaseOperationId: { allowNull: false, type: Sequelize.STRING(160) },
      previousFlightId: { allowNull: false, type: Sequelize.INTEGER },
      replacementFlightId: { allowNull: false, type: Sequelize.INTEGER },
      lastStep: { allowNull: true, type: Sequelize.STRING(60) },
      errorMessage: { allowNull: true, type: Sequelize.STRING(500) },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('RebookingAttempts');
  },
};
