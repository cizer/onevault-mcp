#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "./config.js";
import { fullReindex } from "./indexer.js";
import { searchVault, expandContext, getContextForTopic, getStats } from "./search.js";
import { startWatcher } from "./watcher.js";
import { closeDb } from "./db.js";

const server = new McpServer({
  name: "onevault-mcp",
  version: "0.1.0",
});

// --- Tools ---

server.tool(
  "search_vault",
  "Full-text search over the Obsidian vault. Returns ranked results with snippets. Use for finding specific notes or content matching keywords.",
  {
    query: z.string().describe("Search terms (natural language or FTS5 syntax)"),
    limit: z.number().optional().default(10).describe("Maximum results to return"),
    tag: z.string().optional().describe("Filter results to notes with this tag"),
    path_prefix: z
      .string()
      .optional()
      .describe("Filter to notes under this path prefix (e.g. '2-Areas/', '1-Projects/FTTF/')"),
  },
  async ({ query, limit, tag, path_prefix }) => {
    const results = searchVault(query, { limit, tag, path_prefix });
    if (results.length === 0) {
      return {
        content: [{ type: "text", text: `No results found for: "${query}"` }],
      };
    }
    const formatted = results
      .map(
        (r, i) =>
          `${i + 1}. **${r.title}**\n   Path: ${r.path}\n   Tags: ${r.tags || "none"}\n   ${r.snippet.replace(/>>>/g, "**").replace(/<<</g, "**")}`
      )
      .join("\n\n");
    return {
      content: [{ type: "text", text: `Found ${results.length} results:\n\n${formatted}` }],
    };
  }
);

server.tool(
  "expand_context",
  "Follow wiki-links from a seed note to find related context. Traverses the link graph 1-2 hops outward, returning connected notes with their relationship type (outgoing link, incoming link, 2nd hop).",
  {
    note_path: z
      .string()
      .describe("Path or title of the seed note to expand from"),
    depth: z
      .number()
      .optional()
      .default(1)
      .describe("How many link-hops to follow (1 or 2)"),
    limit: z.number().optional().default(20).describe("Maximum notes to return"),
  },
  async ({ note_path, depth, limit }) => {
    const results = expandContext(note_path, { depth, limit });
    if (results.length === 0) {
      return {
        content: [{ type: "text", text: `No linked notes found for: "${note_path}"` }],
      };
    }
    const formatted = results
      .map(
        (r, i) =>
          `${i + 1}. **${r.title}** [${r.relationship}]\n   Path: ${r.path}\n   ${r.snippet ? r.snippet.slice(0, 150) + "..." : ""}`
      )
      .join("\n\n");
    return {
      content: [
        {
          type: "text",
          text: `Context expanded from "${note_path}" (${results.length} related notes):\n\n${formatted}`,
        },
      ],
    };
  }
);

server.tool(
  "get_context_for_topic",
  "Assemble relevant context for a topic by combining full-text search, link graph traversal, and tag-based expansion. Use this for broad questions where you need a comprehensive context bundle rather than a specific file.",
  {
    topic: z.string().describe("Natural language topic or question"),
    limit: z
      .number()
      .optional()
      .default(15)
      .describe("Maximum notes to include in context bundle"),
    path_prefix: z
      .string()
      .optional()
      .describe("Filter to notes under this path prefix"),
  },
  async ({ topic, limit, path_prefix }) => {
    const results = getContextForTopic(topic, { limit, path_prefix });
    if (results.length === 0) {
      return {
        content: [{ type: "text", text: `No relevant context found for: "${topic}"` }],
      };
    }
    const formatted = results
      .map(
        (r, i) =>
          `${i + 1}. **${r.title}** [${r.relevance}]\n   Path: ${r.path}\n   Tags: ${r.tags || "none"}\n   ${r.snippet ? r.snippet.slice(0, 200) : ""}`
      )
      .join("\n\n");
    return {
      content: [
        {
          type: "text",
          text: `Context for "${topic}" (${results.length} notes assembled):\n\n${formatted}`,
        },
      ],
    };
  }
);

server.tool(
  "vault_stats",
  "Get statistics about the vault index: note count, link count, and top tags.",
  {},
  async () => {
    const stats = getStats();
    const tagList = stats.topTags.map((t) => `  ${t.tag}: ${t.count}`).join("\n");
    return {
      content: [
        {
          type: "text",
          text: `Vault index stats:\n- Notes: ${stats.noteCount}\n- Links: ${stats.linkCount}\n\nTop tags:\n${tagList}`,
        },
      ],
    };
  }
);

server.tool(
  "reindex_vault",
  "Force a full reindex of the vault. Use if the index seems stale or after bulk file operations.",
  {},
  async () => {
    const count = await fullReindex();
    return {
      content: [{ type: "text", text: `Reindexed ${count} notes.` }],
    };
  }
);

// --- Startup ---

async function main() {
  console.error(`[onevault-mcp] Vault: ${config.vaultPath}`);
  console.error(`[onevault-mcp] Database: ${config.dbPath}`);

  // Build initial index
  await fullReindex();

  // Start file watcher for incremental updates
  startWatcher();

  // Connect MCP transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[onevault-mcp] MCP server running on stdio");

  // Graceful shutdown
  process.on("SIGINT", () => {
    closeDb();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    closeDb();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[onevault-mcp] Fatal:", err);
  process.exit(1);
});
