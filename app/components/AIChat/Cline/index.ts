"use client";

/**
 * Re-export the Cline UI primitives we copied verbatim from
 * `/home/lucas/Documents/code/.ref/cline/sdk/packages/ui/components/`.
 * This file is intentionally narrower than the upstream `index.ts`
 * (which also exports `agent-aurora`, `search-combobox`, etc. —
 * components we have not copied, so we keep this entry focused on the
 * primitives the Outline chat actually consumes).
 */
export {
  type AgentApprovalAction,
  AgentApprovalCard,
  type AgentApprovalCardProps,
} from "./agent-approval-card";
