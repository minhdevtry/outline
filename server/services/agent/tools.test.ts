import { describe, expect, it } from "vitest";
import { getAgentToolDefinitions, findToolHandler } from "./tools";

describe("getAgentToolDefinitions", () => {
  it("returns all tools when no skill filter is provided", () => {
    const tools = getAgentToolDefinitions();
    expect(tools.length).toBeGreaterThan(0);
    const names = tools.map((t) => t.name);
    expect(names).toContain("search_documents");
    expect(names).toContain("edit_document");
    expect(names).toContain("read_document");
  });

  it("returns all tools when skillToolNames is empty", () => {
    const tools = getAgentToolDefinitions([]);
    const all = getAgentToolDefinitions();
    expect(tools.map((t) => t.name).sort()).toEqual(
      all.map((t) => t.name).sort()
    );
  });

  it("filters tools to the intersection of skill allow-list", () => {
    const tools = getAgentToolDefinitions([
      "search_documents",
      "read_document",
      "list_documents",
    ]);
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["list_documents", "read_document", "search_documents"].sort()
    );
  });

  it("silently drops skillToolNames that don't match any tool", () => {
    const tools = getAgentToolDefinitions(["search_documents", "ghost_tool"]);
    expect(tools.map((t) => t.name)).toEqual(["search_documents"]);
  });

  it("returns an empty array when the skill has no overlap", () => {
    const tools = getAgentToolDefinitions(["nonexistent_tool"]);
    expect(tools).toEqual([]);
  });
});

describe("findToolHandler", () => {
  it("resolves a registered tool handler", () => {
    expect(typeof findToolHandler("search_documents")).toBe("function");
  });

  it("returns undefined for an unknown tool", () => {
    expect(findToolHandler("does_not_exist")).toBeUndefined();
  });
});
