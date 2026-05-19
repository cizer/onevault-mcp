import chokidar from "chokidar";
import { relative } from "path";
import { config } from "./config.js";
import { indexFile, removeFile } from "./indexer.js";

let watcher = null;

/**
 * Start watching the vault for file changes.
 * Incrementally updates the index on add/change/unlink.
 */
export function startWatcher() {
  if (watcher) return;

  const ignored = config.excludeDirs.map((d) => `**/${d}/**`);
  ignored.push("**/node_modules/**");

  watcher = chokidar.watch("**/*.md", {
    cwd: config.vaultPath,
    ignored,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  // Wrap handlers in try/catch so a single bad file (e.g. malformed
  // frontmatter that trips up the parser) can't take down the MCP server.
  const safe = (label, fn) => (path) => {
    try {
      console.error(`[watcher] ${label}: ${path}`);
      fn(path);
    } catch (err) {
      console.error(`[watcher] ${label} failed for ${path}: ${err && err.message ? err.message : err}`);
    }
  };

  watcher.on("add", safe("added", indexFile));
  watcher.on("change", safe("changed", indexFile));
  watcher.on("unlink", safe("removed", removeFile));

  watcher.on("error", (err) => {
    console.error(`[watcher] error: ${err && err.message ? err.message : err}`);
  });

  console.error("[watcher] Watching vault for changes");
}

export function stopWatcher() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}
