"use strict";

/**
 * Creates `agent_memories` for the AI agent's long-term memory layer.
 * Each row is a single fact the agent has learned about a user, scoped by
 * `userId` + `teamId`. The `embedding` column is a `vector(384)` matching
 * the local `Xenova/multilingual-e5-small` model already used by RAG.
 *
 * Indexes:
 *  - `(teamId, userId, archived)` for fast "list my active memories" queries
 *  - hnsw on `embedding` for cosine-distance nearest-neighbor retrieval
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("agent_memories", {
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
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      category: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: "fact",
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      contentHash: {
        type: Sequelize.CHAR(64),
        allowNull: false,
      },
      embedding: {
        type: "vector(384)",
        allowNull: true,
      },
      model: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      confidence: {
        type: Sequelize.FLOAT,
        allowNull: false,
        defaultValue: 1,
      },
      archived: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      sourceSessionId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "agent_sessions", key: "id" },
        onDelete: "SET NULL",
      },
      lastUsedAt: {
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

    await queryInterface.addIndex(
      "agent_memories",
      ["teamId", "userId", "archived"],
      { name: "agent_memories_user_archived_idx" }
    );

    await queryInterface.addIndex("agent_memories", {
      name: "agent_memories_embedding_hnsw_idx",
      fields: [Sequelize.literal("embedding vector_cosine_ops")],
      using: "hnsw",
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("agent_memories");
  },
};
