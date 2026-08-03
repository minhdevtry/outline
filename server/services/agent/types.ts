import type { User } from "@server/models";

/**
 * The agentic loop emits these events over SSE. The client accumulates them
 * into a `UIMessage[]` (Vercel AI SDK shape) and feeds them into the
 * streaming UI components.
 */
export type AgentEvent =
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_delta"; id: string; args_partial: string }
  | { type: "tool_call_end"; id: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; result: unknown; is_error: boolean }
  | { type: "step_start"; step: number }
  | {
      type: "step_end";
      step: number;
      stop_reason: string;
      usage?: { input_tokens: number; output_tokens: number };
    }
  | {
      type: "sources";
      sources: Array<{
        id: string;
        title: string;
        url: string;
        snippet: string;
      }>;
    }
  | { type: "error"; message: string; code?: string }
  | { type: "session"; sessionId: string }
  | { type: "done" };

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface AgentRunOptions {
  user: User;
  /** The system prompt (built from `team.guidanceMCP` + the agent's role). */
  systemPrompt: string;
  /** The full conversation as a list of {role, content} pairs. */
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /** The tool list the agent can call. */
  tools: AgentTool[];
  /** Abort signal — when aborted, the loop stops at the next safe checkpoint. */
  signal: AbortSignal;
  /** Max agent steps before forcing end. Default 8. */
  maxSteps?: number;
  /**
   * Optional id of the document the user is currently viewing. The route
   * resolves this into a `currentDocument` block inside the system prompt.
   * Agents that read this must call `read_document(documentId)` for the
   * full text rather than relying on the prompt.
   */
  currentDocumentId?: string;

  /**
   * Optional range of the user's current text selection in the editor. The
   * route resolves this into a `currentSelection` block inside the system
   * prompt so the model can act on a sub-range without re-reading the full
   * document. `text` is truncated by the client.
   */
  currentSelection?: { from: number; to: number; text: string };

  /** Model name requested by user. */
  model?: string;
}

/**
 * Thrown when no valid Mistral key is configured for the team. Callers should
 * map this to a 400 response.
 */
export class NoValidEmbeddingKeyError extends Error {
  constructor() {
    super("No valid Mistral API key configured for this team");
    this.name = "NoValidEmbeddingKeyError";
  }
}
