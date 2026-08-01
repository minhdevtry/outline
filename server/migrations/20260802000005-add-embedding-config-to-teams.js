"use strict";

/**
 * Per-team configuration for the RAG pipeline. `embeddingModel` and the chunk
 * size controls default to sensible values; admins can override later via the
 * AI settings UI.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn("teams", "embeddingModel", {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: "mistral-embed",
    });
    await queryInterface.addColumn("teams", "embeddingChunkSize", {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: 800,
    });
    await queryInterface.addColumn("teams", "embeddingChunkOverlap", {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: 200,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn("teams", "embeddingChunkOverlap");
    await queryInterface.removeColumn("teams", "embeddingChunkSize");
    await queryInterface.removeColumn("teams", "embeddingModel");
  },
};
