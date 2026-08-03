import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  Column,
  Table,
  DataType,
  ForeignKey,
  BelongsTo,
  Index,
  Default,
  Length,
} from "sequelize-typescript";
import Team from "./Team";
import IdModel from "./base/IdModel";

/**
 * Per-workspace LLM provider keys. One row per `(teamId, provider)`.
 * The agent runtime reads these on start; if absent, the env vars
 * (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) take over. Mirrors Cline's
 * `Account`-style provider config (`packages/llms/src/services/`)
 * simplified to a single key per provider per workspace.
 *
 * The `apiKey` column is encrypted-at-rest in the database; this file
 * only stores the envelope. Encryption is wired in Phase 5.
 */
@Table({ tableName: "agent_provider_keys", modelName: "agentProviderKey" })
class AgentProviderKey extends IdModel<
  InferAttributes<AgentProviderKey>,
  Partial<InferCreationAttributes<AgentProviderKey>>
> {
  @ForeignKey(() => Team)
  @Index
  @Column(DataType.UUID)
  teamId: string;

  @BelongsTo(() => Team)
  team: Team;

  /** Provider ID. Validated against the closed union in
   * `services/agent/providerFactory.ts`. */
  @Index
  @Length({ max: 50 })
  @Column(DataType.STRING)
  provider: "openai" | "anthropic" | "openai-compatible";

  /** Encrypted-at-rest API key. */
  @Column(DataType.TEXT)
  apiKey: string;

  /** OpenAI-compatible endpoint. Required when `provider` is
   * `openai-compatible`; ignored for the other two. */
  @Length({ max: 500 })
  @Default(null)
  @Column(DataType.STRING)
  baseUrl: string | null;

  /** Default model for this provider (e.g. `claude-sonnet-4-6`,
   * `gpt-4o-mini`). */
  @Length({ max: 100 })
  @Default(null)
  @Column(DataType.STRING)
  model: string | null;

  @Default(true)
  @Column(DataType.BOOLEAN)
  enabled: boolean;
}

export default AgentProviderKey;
