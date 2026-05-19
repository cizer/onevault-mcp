#!/usr/bin/env node

import { config } from "./config.js";
import { fullReindex } from "./indexer.js";
import { getStats } from "./search.js";
import { closeDb } from "./db.js";

async function main() {
  console.log(`Corpus: ${config.vaultPath}`);
  console.log(`Database: ${config.dbPath}`);
  console.log("Building index...");

  const count = await fullReindex();
  const stats = getStats();

  console.log(`\nDone.`);
  console.log(`  Notes indexed: ${stats.noteCount}`);
  console.log(`  Links tracked: ${stats.linkCount}`);
  console.log(`  Top tags: ${stats.topTags.slice(0, 10).map((t) => t.tag).join(", ")}`);

  closeDb();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
