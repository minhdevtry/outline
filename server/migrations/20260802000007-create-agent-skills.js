"use strict";

/**
 * Creates `agent_skills` table for the AI agent's persona/skill registry.
 * Each skill is team-scoped, has a system prompt fragment, and a list of
 * tool names that limit the agent's capabilities when the skill is active.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("agent_skills", {
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
      name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      displayName: {
        type: Sequelize.STRING(200),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      systemPromptFragment: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: "",
      },
      toolNames: {
        type: Sequelize.ARRAY(Sequelize.STRING),
        allowNull: false,
        defaultValue: [],
      },
      isDefault: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      icon: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      color: {
        type: Sequelize.STRING(20),
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

    await queryInterface.addIndex("agent_skills", ["teamId", "name"], {
      unique: true,
      name: "agent_skills_team_name_unique",
    });
    await queryInterface.addIndex("agent_skills", ["teamId", "isDefault"], {
      name: "agent_skills_team_default_idx",
    });

    // Seed 3 starter skills for every existing team so the picker has
    // something to show out of the box. Admins can edit/delete later.
    const teams =
      (await queryInterface.sequelize.query) <
      { id: string } >
      (`SELECT id FROM teams`, { type: "SELECT" });
    const now = Sequelize.literal("NOW()");
    for (const { id: teamId } of teams) {
      await queryInterface.bulkInsert("agent_skills", [
        {
          teamId,
          name: "general",
          displayName: "General Assistant",
          description:
            "All-purpose assistant with full access to the workspace. The default skill when none is selected.",
          systemPromptFragment: "",
          toolNames: [],
          isDefault: true,
          icon: "SparklesIcon",
          color: null,
          createdAt: now,
          updatedAt: now,
        },
        {
          teamId,
          name: "researcher",
          displayName: "Researcher",
          description:
            "Read-only skill focused on finding and summarizing information across the workspace. Cannot edit documents.",
          systemPromptFragment:
            "You are a research assistant. Default to read-only tools: search, read, list, and outline. Do not propose edits to documents unless the user explicitly asks. When answering, cite sources inline using [N] matching the order returned by search_documents.",
          toolNames: [
            "search_documents",
            "read_document",
            "list_documents",
            "get_document_outline",
            "get_revisions",
            "list_collections",
            "search_users",
            "add_comment",
            "delete_comment",
          ],
          isDefault: false,
          icon: "SearchIcon",
          color: "#3B82F6",
          createdAt: now,
          updatedAt: now,
        },
        {
          teamId,
          name: "editor",
          displayName: "Editor",
          description:
            "Focused on improving existing documents: rewrites, edits, title changes, and bulk organization. Skips research tools.",
          systemPromptFragment:
            "You are an editor. Default to write-side tools: edit_document, update_title, set_publish_state, move_document, archive_document, duplicate_document, bulk_update, bulk_move. Avoid search/read unless needed for context. Be conservative — propose surgical edits, not wholesale rewrites.",
          toolNames: [
            "read_document",
            "edit_document",
            "update_title",
            "set_publish_state",
            "move_document",
            "archive_document",
            "duplicate_document",
            "create_document",
            "create_collection",
            "list_collections",
            "list_documents",
            "bulk_update",
            "bulk_move",
            "add_comment",
          ],
          isDefault: false,
          icon: "EditIcon",
          color: "#10B981",
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable("agent_skills");
  },
};
