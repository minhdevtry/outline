"use strict";

/**
 * Creates `agent_provider_keys` for per-workspace LLM provider keys.
 * One row per `(teamId, provider)`; the agent runtime reads this table
 * at start and falls back to env vars when no row is present.
 *
 * NOTE: The `apiKey` column is stored as TEXT here. Encryption-at-rest
 * is wired in a follow-up migration (Phase 5). The plaintext column
 * is intentional for the scaffold.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("agent_provider_keys", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal("uuid_generate_v4()"),
      },
      teamId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "teams", key: "id" },
        onDelete: "CASCADE",
      },
      provider: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      apiKey: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      baseUrl: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      model: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    await queryInterface.addIndex(
      "agent_provider_keys",
      ["teamId", "provider"],
      { unique: true, name: "agent_provider_keys_team_provider_unique" }
    );
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("agent_provider_keys");
  },
};
