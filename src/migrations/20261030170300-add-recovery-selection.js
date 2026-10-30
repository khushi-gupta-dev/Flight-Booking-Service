'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('RecoveryCases', 'selectedAlternativeId', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('RecoveryCases', 'selectedAlternativeId');
  },
};
