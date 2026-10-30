'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('RecoveryAlternatives', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      recoveryCaseId: { allowNull: false, type: Sequelize.INTEGER },
      replacementFlightId: { allowNull: false, type: Sequelize.INTEGER },
      departureTime: { allowNull: false, type: Sequelize.DATE },
      arrivalTime: { allowNull: false, type: Sequelize.DATE },
      price: { allowNull: false, type: Sequelize.INTEGER },
      availableSeats: { allowNull: false, type: Sequelize.INTEGER },
      score: { allowNull: false, type: Sequelize.DECIMAL(8, 4) },
      explanation: { allowNull: false, type: Sequelize.STRING(500) },
      status: {
        allowNull: false,
        defaultValue: 'available',
        type: Sequelize.ENUM('available', 'expired', 'selected', 'unavailable'),
      },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addConstraint('RecoveryAlternatives', {
      fields: ['recoveryCaseId', 'replacementFlightId'],
      type: 'unique',
      name: 'recovery_alternatives_case_flight_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('RecoveryAlternatives');
  },
};
