import { describe, expect, it } from "vitest";
import { PLAN_MODE_TOOLS, ACT_MODE_TOOLS, submitPlanTool } from "./planMode";

/* -------------------------------------------------------------------------- */
/*  Plan-mode toolset selection (mirrors Cline's `corePlanModeTools`)      */
/* -------------------------------------------------------------------------- */

describe("PLAN_MODE_TOOLS", () => {
  it("includes the submit_plan tool and only read-only tools", () => {
    expect(PLAN_MODE_TOOLS).toContain("submit_plan");
    expect(PLAN_MODE_TOOLS).toContain("search_documents");
    expect(PLAN_MODE_TOOLS).toContain("read_document");
    expect(PLAN_MODE_TOOLS).toContain("list_collections");
  });

  it("does NOT include write tools (those belong to act mode)", () => {
    expect(PLAN_MODE_TOOLS).not.toContain("create_document");
    expect(PLAN_MODE_TOOLS).not.toContain("edit_document");
    expect(PLAN_MODE_TOOLS).not.toContain("update_title");
    expect(PLAN_MODE_TOOLS).not.toContain("bulk_update");
    expect(PLAN_MODE_TOOLS).not.toContain("bulk_move");
  });
});

describe("ACT_MODE_TOOLS", () => {
  it("does NOT include the plan-only submit_plan tool", () => {
    expect(ACT_MODE_TOOLS).not.toContain("submit_plan");
  });

  it("includes the full write toolset", () => {
    expect(ACT_MODE_TOOLS).toContain("create_document");
    expect(ACT_MODE_TOOLS).toContain("edit_document");
    expect(ACT_MODE_TOOLS).toContain("update_title");
    expect(ACT_MODE_TOOLS).toContain("set_publish_state");
    expect(ACT_MODE_TOOLS).toContain("move_document");
    expect(ACT_MODE_TOOLS).toContain("archive_document");
    expect(ACT_MODE_TOOLS).toContain("duplicate_document");
    expect(ACT_MODE_TOOLS).toContain("create_collection");
    expect(ACT_MODE_TOOLS).toContain("bulk_update");
    expect(ACT_MODE_TOOLS).toContain("bulk_move");
  });
});

describe("submitPlanTool", () => {
  it("is registered as a completion tool (ends the agent run)", () => {
    expect(submitPlanTool.name).toBe("submit_plan");
    expect(submitPlanTool.lifecycle?.completesRun).toBe(true);
  });

  it("returns a pending plan status on successful execution", async () => {
    const result = await submitPlanTool.execute(
      {
        goal: "Test",
        steps: [{ tool: "search_documents", intent: "Find docs" }],
      },
      {
        agentId: "a",
        conversationId: "c",
        iteration: 1,
      }
    );
    if (result.isError) {
      throw new Error("expected ok");
    }
    const output = result.output as { status: string };
    expect(output.status).toBe("pending");
  });
});
