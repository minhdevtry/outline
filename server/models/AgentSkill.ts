import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  Column,
  Table,
  DataType,
  ForeignKey,
  BelongsTo,
  Default,
  Length,
  Index,
} from "sequelize-typescript";
import Team from "./Team";
import User from "./User";
import IdModel from "./base/IdModel";

/**
 * A reusable skill (a.k.a. persona) for the AI agent. Each skill
 * contributes a `systemPromptFragment` that gets appended to the system
 * prompt when active, and a `toolNames` subset that limits which tools
 * the agent can call. This lets a team pre-bake common workflows
 * ("Researcher", "Editor", "Translator") and switch between them per
 * conversation.
 *
 * Skills are team-scoped (every team has its own set) and user-editable by
 * anyone with AI access. Admins can mark a skill as `isDefault` to make
 * it the auto-selected skill for new sessions.
 */
@Table({ tableName: "agent_skills", modelName: "agentSkill" })
class AgentSkill extends IdModel<
  InferAttributes<AgentSkill>,
  Partial<InferCreationAttributes<AgentSkill>>
> {
  @ForeignKey(() => Team)
  @Index
  @Column(DataType.UUID)
  teamId: string;

  @BelongsTo(() => Team)
  team: Team;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  createdById: string;

  @BelongsTo(() => User)
  createdBy: User;

  @Index
  @Length({ max: 100 })
  @Column(DataType.STRING)
  name: string;

  @Length({ max: 200 })
  @Column(DataType.STRING)
  displayName: string;

  @Column(DataType.TEXT)
  description: string | null;

  @Column(DataType.TEXT)
  systemPromptFragment: string;

  /** Names of tools the agent can call when this skill is active. Empty = all tools. */
  @Column(DataType.ARRAY(DataType.STRING))
  toolNames: string[];

  @Default(false)
  @Column(DataType.BOOLEAN)
  isDefault: boolean;

  @Length({ max: 50 })
  @Column(DataType.STRING)
  icon: string | null;

  @Length({ max: 20 })
  @Column(DataType.STRING)
  color: string | null;
}

export default AgentSkill;
