"use strict";

/**
 * `embedding_jobs` is a one-row-per-document status tracker for the RAG
 * indexing pipeline. The UNIQUE(documentId) constraint guarantees at most
 * one active job per document, so concurrent schedules collapse cleanly.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(`
      CREATE TYPE embedding_job_status AS ENUM ('pending', 'in_progress', 'completed', 'failed');
    `);

    await queryInterface.createTable("embedding_jobs", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal("uuid_generate_v4()"),
      },
      documentId: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
        references: { model: "documents", key: "id" },
        onDelete: "CASCADE",
      },
      teamId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "teams", key: "id" },
        onDelete: "CASCADE",
      },
      status: {
        type: "embedding_job_status",
        allowNull: false,
        defaultValue: "pending",
      },
      chunksCount: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      errorMessage: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      startedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      completedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("NOW()"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("NOW()"),
      },
    });

    await queryInterface.addIndex("embedding_jobs", ["teamId", "status"], {
      name: "embedding_jobs_team_status_idx",
    });
    await queryInterface.addIndex("embedding_jobs", ["status"], {
      name: "embedding_jobs_status_idx",
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("embedding_jobs");
    await queryInterface.sequelize.query("DROP TYPE IF EXISTS embedding_job_status;");
  },
};
