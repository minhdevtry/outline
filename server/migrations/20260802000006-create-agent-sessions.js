"use strict";

/**
 * Creates `agent_sessions` and `agent_messages` tables for the AI agent's
 * persistent conversation history. Sessions belong to a single user within
 * a team; messages belong to a session and are joined in `createdAt` order.
 *
 * The `parts` column on messages is a JSON blob matching the Vercel AI SDK
 * `UIMessage` shape used by the client (text, tool_call, tool_result).
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("agent_sessions", {
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
      title: {
        type: Sequelize.STRING(200),
        allowNull: false,
        defaultValue: "",
      },
      contextDocumentId: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      lastMessageAt: {
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
      "agent_sessions",
      ["userId", "lastMessageAt"],
      { name: "agent_sessions_user_last_message_idx" }
    );

    await queryInterface.createTable("agent_messages", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal("uuid_generate_v4()"),
      },
      sessionId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "agent_sessions", key: "id" },
        onDelete: "CASCADE",
      },
      role: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      parts: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: "[]",
      },
      inputTokens: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      outputTokens: {
        type: Sequelize.INTEGER,
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
      "agent_messages",
      ["sessionId", "createdAt"],
      {
        name: "agent_messages_session_created_idx",
      }
    );
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("agent_messages");
    await queryInterface.dropTable("agent_sessions");
  },
};
