import { readFileSync, statSync } from "fs";
import { resolve, relative } from "path";
import { glob } from "fs/promises";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { parseNote } from "./parser.js";

/**
 * Full reindex of the vault.
 * Walks all .md files, parses them, and upserts into the database.
 */
export async function fullReindex() {
  const db = getDb();
  const vaultPath = config.vaultPath;

  // Collect all markdown files
  const files = [];
  for await (const entry of glob("**/*.md", { cwd: vaultPath })) {
    if (shouldExclude(entry)) continue;
    files.push(entry);
  }

  console.error(`[indexer] Found ${files.length} markdown files`);

  const upsertNote = db.prepare(`
    INSERT OR REPLACE INTO notes (path, title, body, tags, frontmatter, mtime)
    VALUES (@path, @title, @body, @tags, @frontmatter, @mtime)
  `);

  const deleteLinks = db.prepare(`DELETE FROM links WHERE source_path = ?`);
  const insertLink = db.prepare(`
    INSERT OR IGNORE INTO links (source_path, target) VALUES (?, ?)
  `);

  const existingPaths = new Set(
    db.prepare("SELECT path FROM notes").all().map((r) => r.path)
  );

  const indexBatch = db.transaction((batch) => {
    for (const { relativePath, title, body, tags, frontmatter, mtime, links } of batch) {
      upsertNote.run({
        path: relativePath,
        title,
        body,
        tags: tags.join(" "),
        frontmatter: JSON.stringify(frontmatter),
        mtime,
      });

      deleteLinks.run(relativePath);
      for (const link of links) {
        insertLink.run(relativePath, link);
      }

      existingPaths.delete(relativePath);
    }
  });

  // Process in batches of 500
  const BATCH_SIZE = 500;
  let batch = [];
  let indexed = 0;

  for (const relativePath of files) {
    const fullPath = resolve(vaultPath, relativePath);
    let content, stat;
    try {
      content = readFileSync(fullPath, "utf-8");
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    const { title, frontmatter, body, links, tags } = parseNote(content, relativePath);

    batch.push({
      relativePath,
      title,
      body,
      tags,
      frontmatter,
      mtime: stat.mtimeMs,
      links,
    });

    if (batch.length >= BATCH_SIZE) {
      indexBatch(batch);
      indexed += batch.length;
      batch = [];
    }
  }

  if (batch.length > 0) {
    indexBatch(batch);
    indexed += batch.length;
  }

  // Remove notes that no longer exist on disk
  if (existingPaths.size > 0) {
    const deleteNote = db.prepare("DELETE FROM notes WHERE path = ?");
    const deleteNoteLinks = db.prepare("DELETE FROM links WHERE source_path = ?");
    const removeBatch = db.transaction((paths) => {
      for (const p of paths) {
        deleteNote.run(p);
        deleteNoteLinks.run(p);
      }
    });
    removeBatch([...existingPaths]);
    console.error(`[indexer] Removed ${existingPaths.size} stale entries`);
  }

  console.error(`[indexer] Indexed ${indexed} notes`);
  return indexed;
}

/**
 * Index or update a single file.
 */
export function indexFile(relativePath) {
  const db = getDb();
  const fullPath = resolve(config.vaultPath, relativePath);

  let content, stat;
  try {
    content = readFileSync(fullPath, "utf-8");
    stat = statSync(fullPath);
  } catch {
    // File was deleted
    removeFile(relativePath);
    return;
  }

  const { title, frontmatter, body, links, tags } = parseNote(content, relativePath);

  db.prepare(`
    INSERT OR REPLACE INTO notes (path, title, body, tags, frontmatter, mtime)
    VALUES (@path, @title, @body, @tags, @frontmatter, @mtime)
  `).run({
    path: relativePath,
    title,
    body,
    tags: tags.join(" "),
    frontmatter: JSON.stringify(frontmatter),
    mtime: stat.mtimeMs,
  });

  db.prepare("DELETE FROM links WHERE source_path = ?").run(relativePath);
  const insertLink = db.prepare(
    "INSERT OR IGNORE INTO links (source_path, target) VALUES (?, ?)"
  );
  for (const link of links) {
    insertLink.run(relativePath, link);
  }
}

/**
 * Remove a file from the index.
 */
export function removeFile(relativePath) {
  const db = getDb();
  db.prepare("DELETE FROM notes WHERE path = ?").run(relativePath);
  db.prepare("DELETE FROM links WHERE source_path = ?").run(relativePath);
}

function shouldExclude(relativePath) {
  for (const dir of config.excludeDirs) {
    if (relativePath.startsWith(dir + "/") || relativePath === dir) {
      return true;
    }
  }
  return false;
}
