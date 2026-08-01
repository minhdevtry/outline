"use strict";

module.exports = {
  up: async (queryInterface) => {
    // The pgvector extension must be present in the database before any
    // table with a `vector(...)` column can be created. Idempotent.
    await queryInterface.sequelize.query("CREATE EXTENSION IF NOT EXISTS vector;");
  },
  down: async (queryInterface) => {
    await queryInterface.sequelize.query("DROP EXTENSION IF EXISTS vector;");
  },
};
