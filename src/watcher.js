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

  watcher.on("add", (path) => {
    console.error(`[watcher] added: ${path}`);
    indexFile(path);
  });

  watcher.on("change", (path) => {
    console.error(`[watcher] changed: ${path}`);
    indexFile(path);
  });

  watcher.on("unlink", (path) => {
    console.error(`[watcher] removed: ${path}`);
    removeFile(path);
  });

  watcher.on("error", (err) => {
    console.error(`[watcher] error: ${err.message}`);
  });

  console.error("[watcher] Watching vault for changes");
}

export function stopWatcher() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}
