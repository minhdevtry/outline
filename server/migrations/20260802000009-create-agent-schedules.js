"use strict";

/**
 * Creates `agent_schedules` for the AI agent's scheduler. Each row is a
 * cron-style scheduled run that the Bull `DispatchAgentSchedulesTask`
 * (added in Phase 3.9) polls once per minute.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("agent_schedules", {
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
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      cron: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      prompt: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      agentId: {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: "agent",
      },
      nextRunAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("NOW()"),
      },
      lastRunAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      lastRunId: {
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

    await queryInterface.addIndex("agent_schedules", ["enabled", "nextRunAt"], {
      name: "agent_schedules_due_idx",
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("agent_schedules");
  },
};
