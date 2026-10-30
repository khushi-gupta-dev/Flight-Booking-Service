'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('RecoveryCases', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      disruptionId: { allowNull: false, type: Sequelize.INTEGER },
      bookingId: { allowNull: false, type: Sequelize.INTEGER },
      userId: { allowNull: false, type: Sequelize.INTEGER },
      status: {
        allowNull: false,
        defaultValue: 'created',
        type: Sequelize.ENUM('created', 'awaiting_alternatives', 'awaiting_approval', 'declined', 'rebooking', 'completed', 'failed'),
      },
      expiresAt: { allowNull: true, type: Sequelize.DATE },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addConstraint('RecoveryCases', {
      fields: ['disruptionId', 'bookingId'],
      type: 'unique',
      name: 'recovery_cases_disruption_booking_unique',
    });

    await queryInterface.createTable('RecoveryAuditEvents', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      aggregateType: { allowNull: false, type: Sequelize.STRING(40) },
      aggregateId: { allowNull: false, type: Sequelize.STRING(80) },
      eventType: { allowNull: false, type: Sequelize.STRING(80) },
      actorType: { allowNull: false, type: Sequelize.STRING(24) },
      actorId: { allowNull: true, type: Sequelize.STRING(80) },
      correlationId: { allowNull: false, type: Sequelize.STRING(120) },
      payload: { allowNull: false, type: Sequelize.JSON },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });

    await queryInterface.createTable('ProcessedRecoveryEvents', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      eventId: { allowNull: false, unique: true, type: Sequelize.STRING(120) },
      eventType: { allowNull: false, type: Sequelize.STRING(80) },
      correlationId: { allowNull: false, type: Sequelize.STRING(120) },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ProcessedRecoveryEvents');
    await queryInterface.dropTable('RecoveryAuditEvents');
    await queryInterface.dropTable('RecoveryCases');
  },
};
