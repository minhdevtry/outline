/* -------------------------------------------------------------------------- */
/*  MCP server for Outline's internal services                                 */
/* -------------------------------------------------------------------------- */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * Standalone MCP server that exposes Outline's internal services
 * (`search_documents`, `read_document`, `list_documents`, etc.) over
 * stdin. Designed to be spawned by the Cline SDK as a streamable-HTTP
 * client, or invoked by any other MCP-compatible agent host.
 *
 * The actual tool bodies are stubs in this scaffold — wire them to the
 * real handlers in `server/services/agent/tools.ts` when integrating
 * with Cline. Mirrors the `cline_mcp_settings.json` convention.
 */
export function buildMcpServer(): Server {
  const server = new Server(
    {
      name: "outline-agent-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "search_documents",
        description:
          "Search the workspace's documents using semantic + keyword hybrid search.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            limit: { type: "number", description: "Max results" },
          },
          required: ["query"],
        },
      },
      {
        name: "read_document",
        description: "Read the full text of a document by id or title.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string" },
            documentTitle: { type: "string" },
          },
        },
      },
      {
        name: "list_documents",
        description:
          "List documents in the workspace, optionally filtered by collection.",
        inputSchema: {
          type: "object",
          properties: {
            collectionId: { type: "string" },
            limit: { type: "number" },
          },
        },
      },
      {
        name: "get_document_outline",
        description:
          "Return the heading outline (table of contents) of a document.",
        inputSchema: {
          type: "object",
          properties: { documentId: { type: "string" } },
          required: ["documentId"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    switch (name) {
      case "search_documents":
      case "read_document":
      case "list_documents":
      case "get_document_outline":
        // Real implementation is wired in `server/services/agent/tools.ts`.
        // For now the stub returns a placeholder so the MCP handshake
        // succeeds and the Cline-side tool discovery works end-to-end.
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                stub: true,
                tool: name,
                args,
                message:
                  "Tool body not wired yet — connect to server/services/agent/tools.ts",
              }),
            },
          ],
        };
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  });

  return server;
}

/* -------------------------------------------------------------------------- */
/*  Entry point — when this file is run directly via `node mcpServer.ts`     */
/* -------------------------------------------------------------------------- */

if (require.main === module) {
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  server.connect(transport).catch((err: Error) => {
    // eslint-disable-next-line no-console
    console.error(`MCP server failed to start: ${err.message}`);
    process.exit(1);
  });
}
