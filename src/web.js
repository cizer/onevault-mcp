#!/Users/richie.mackay/.nvm/versions/node/v24.12.0/bin/node

/**
 * OneVault web search — a Google-style search page over the same FTS5 index
 * the MCP server uses. It reuses search.js + vault.db directly (the MCP wire
 * protocol is for AI clients, not browsers), so results are identical to
 * `mcp__onevault__search_vault`.
 *
 * Binds to 127.0.0.1 only: the vault holds personal/people data, so the page
 * is never exposed on the network.
 *
 *   node src/web.js            → http://127.0.0.1:4321
 *   ONEVAULT_WEB_PORT=8080 …   → override the port
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, basename } from "node:path";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { searchVault, getStats } from "./search.js";
import { fullReindex } from "./indexer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.ONEVAULT_WEB_PORT || 4321);
const HOST = "127.0.0.1"; // localhost only — never bind to 0.0.0.0 for a personal vault
const VAULT_NAME = process.env.OBSIDIAN_VAULT || basename(config.vaultPath || "OneVault");
const HTML_PATH = resolve(__dirname, "web", "index.html");

/** Build an obsidian:// deep link that opens the note in the Obsidian app. */
function obsidianUri(path) {
  const file = path.replace(/\.md$/i, "");
  return `obsidian://open?vault=${encodeURIComponent(VAULT_NAME)}&file=${encodeURIComponent(file)}`;
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function handleSearch(res, params) {
  const query = (params.get("q") || "").trim();
  // FTS drops single-char terms; mirror that so the UI and engine agree.
  if (query.length < 2) {
    return sendJson(res, 200, { query, count: 0, ms: 0, results: [] });
  }
  const limit = Math.min(Math.max(Number(params.get("limit") || 20), 1), 50);
  const tag = params.get("tag") || undefined;
  const path_prefix = params.get("path_prefix") || undefined;

  const t0 = process.hrtime.bigint();
  const rows = searchVault(query, { limit, tag, path_prefix });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  const results = rows.map((r) => ({
    title: r.title,
    path: r.path,
    snippet: r.snippet || "",
    tags: r.tags ? r.tags.split(" ").filter(Boolean) : [],
    obsidian: obsidianUri(r.path),
  }));

  sendJson(res, 200, { query, count: results.length, ms: Math.round(ms * 10) / 10, results });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(readFileSync(HTML_PATH, "utf-8")); // read per-request so the page is editable live
    }
    if (req.method === "GET" && url.pathname === "/api/search") {
      return handleSearch(res, url.searchParams);
    }
    if (req.method === "GET" && url.pathname === "/api/stats") {
      return sendJson(res, 200, { ...getStats(), vaultName: VAULT_NAME });
    }
    if (req.method === "POST" && url.pathname === "/api/reindex") {
      const indexed = await fullReindex();
      return sendJson(res, 200, { indexed });
    }
    sendJson(res, 404, { error: "not_found" });
  } catch (err) {
    sendJson(res, 500, { error: String(err?.message || err) });
  }
});

// Warm the DB connection and give writes a grace window so a concurrent
// reindex (MCP watcher or /api/reindex) never trips SQLITE_BUSY.
getDb().pragma("busy_timeout = 3000");

server.listen(PORT, HOST, () => {
  console.log(`OneVault search  →  http://${HOST}:${PORT}`);
  console.log(`vault: ${VAULT_NAME}  ·  db: ${config.dbPath}`);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
