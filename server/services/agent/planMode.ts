import { z } from "zod";
import { createTool, type AgentToolDef } from "./agentLoop";

/* -------------------------------------------------------------------------- */
/*  Plan-and-execute mode                                                     */
/* -------------------------------------------------------------------------- */

/**
 * In Cline, plan/act is a *global* setting (CoreGlobalPlanActMode), not a
 * runtime flag. The host toggles between modes by re-running the agent
 * with a different toolset and a different system prompt. Here we follow
 * the same model: plan mode = read-only tools + the special
 * `submit_plan` completion tool; act mode = full toolset.
 *
 * Both modes share the same `agentLoop` runtime. Switching is a
 * configuration change, not a code change.
 */

const PlanStepSchema = z.object({
  tool: z.string().describe("Tool the agent will call (e.g. search_documents)"),
  intent: z
    .string()
    .describe("One-sentence human description of why this step is needed."),
  arguments: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Optional pre-computed tool arguments."),
});

const SubmitPlanInputSchema = z.object({
  goal: z.string().describe("Plain-language restatement of the user's goal."),
  steps: z
    .array(PlanStepSchema)
    .min(1)
    .max(20)
    .describe("The ordered list of tool calls the agent intends to make."),
  assumptions: z
    .array(z.string())
    .optional()
    .describe("Things the agent is assuming but did not verify."),
});

export interface SubmitPlanResult {
  approved: boolean;
  reason?: string;
}

export interface PendingPlan {
  plan: z.infer<typeof SubmitPlanInputSchema>;
  status: "pending" | "approved" | "rejected";
  rejectionReason?: string;
}

/**
 * The `submit_plan` tool is shown to the agent only in plan mode. It
 * carries `lifecycle.completesRun: true` so a successful call ends the
 * plan-mode run, and the host can show the plan to the user for
 * approval before switching to act mode.
 *
 * The host implements `requestPlanApproval` separately from
 * `requestToolApproval` because a plan is a sequence of tool calls
 * (not a single one) and the UI is a confirmation card rather than a
 * per-call permission prompt.
 */
export const submitPlanTool: AgentToolDef = createTool({
  name: "submit_plan",
  description:
    "Submit a structured execution plan for the user's request. Use this tool in plan mode to commit to a sequence of tool calls. The user reviews the plan before execution. In act mode, this tool is not available — use the write tools directly.",
  inputSchema: SubmitPlanInputSchema as unknown,
  execute: async (input) => {
    const parsed = SubmitPlanInputSchema.parse(input);
    return { output: { plan: parsed, status: "pending" as const } };
  },
  lifecycle: { completesRun: true },
});

/** Read-only toolset available in plan mode. */
export const PLAN_MODE_TOOLS: string[] = [
  "search_documents",
  "read_document",
  "list_documents",
  "get_document_outline",
  "get_revisions",
  "list_collections",
  "search_users",
  "read_document_outline",
  "submit_plan",
];

/** Full toolset available in act mode (everything except `submit_plan`). */
export const ACT_MODE_TOOLS: string[] = [
  "search_documents",
  "read_document",
  "list_documents",
  "get_document_outline",
  "get_revisions",
  "list_collections",
  "search_users",
  "create_document",
  "edit_document",
  "update_title",
  "set_publish_state",
  "move_document",
  "archive_document",
  "duplicate_document",
  "create_collection",
  "bulk_update",
  "bulk_move",
  "add_comment",
  "delete_comment",
];

/** System prompt fragment for plan mode. */
export const PLAN_MODE_SYSTEM_PROMPT_FRAGMENT = `

You are in PLAN MODE. The user wants to review a structured plan before any tools run. You MUST NOT execute write tools (create_document, edit_document, update_title, set_publish_state, move_document, archive_document, duplicate_document, create_collection, bulk_update, bulk_move, add_comment, delete_comment). Only use the read-only tools (search_documents, read_document, list_documents, get_document_outline, get_revisions, list_collections, search_users) plus submit_plan.

When you are ready, call submit_plan with:
  - "goal": a plain-language restatement of what the user asked
  - "steps": an ordered list of {tool, intent, arguments}
  - "assumptions": optional list of things you assumed but didn't verify
The plan is presented to the user. They approve or reject. If approved, the host switches to act mode and replays your tool calls. If rejected, you are re-run with the user's feedback.`;

/** System prompt fragment for act mode. */
export const ACT_MODE_SYSTEM_PROMPT_FRAGMENT = `

You are in ACT MODE. The user has already approved your plan. You may now call any of the available tools to execute the plan. Be conservative: prefer surgical changes (edit_document, update_title) over wholesale rewrites. Each tool call should be reviewable in the agent panel.`;
