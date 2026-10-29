'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Bookings', 'idempotencyKey', {
      type: Sequelize.STRING(120),
      allowNull: true,
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Bookings', 'idempotencyKey');
  },
};
