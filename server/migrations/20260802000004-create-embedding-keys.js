"use strict";

/**
 * `embedding_keys` is the per-team pool of Mistral API keys used by the RAG
 * pipeline. The actual key bytes are stored encrypted (AES-256-GCM with a
 * key derived from `env.SECRET_KEY`); the API only ever returns obfuscated
 * metadata (`prefix`, `last4`, validity, usage counters). The UNIQUE
 * (teamId, prefix, last4) constraint prevents accidentally adding the same
 * key twice.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("embedding_keys", {
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
      createdById: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      label: {
        type: Sequelize.STRING(120),
        allowNull: false,
      },
      prefix: {
        type: Sequelize.STRING(16),
        allowNull: false,
      },
      last4: {
        type: Sequelize.STRING(4),
        allowNull: false,
      },
      encryptedKey: {
        type: Sequelize.BLOB,
        allowNull: false,
      },
      isValid: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      lastUsedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      lastErrorAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      lastError: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      requestCount: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
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
      "embedding_keys",
      ["teamId", "prefix", "last4"],
      { name: "embedding_keys_team_prefix_last4_uniq", unique: true }
    );
    await queryInterface.addIndex("embedding_keys", ["teamId", "isValid"], {
      name: "embedding_keys_team_valid_idx",
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("embedding_keys");
  },
};
