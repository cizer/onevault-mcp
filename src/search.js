import { getDb } from "./db.js";

/**
 * Full-text search over the vault using FTS5.
 * Returns ranked results with snippets.
 *
 * @param {string} query - search terms
 * @param {object} options
 * @param {number} [options.limit=10] - max results
 * @param {string} [options.tag] - filter by tag
 * @param {string} [options.path_prefix] - filter by path prefix (e.g. "2-Areas/")
 * @returns {Array<{ path: string, title: string, snippet: string, rank: number, tags: string }>}
 */
export function searchVault(query, { limit = 10, tag, path_prefix } = {}) {
  const db = getDb();

  // Build FTS query — support both natural language and explicit FTS syntax
  const ftsQuery = buildFtsQuery(query);

  let sql = `
    SELECT
      n.path,
      n.title,
      snippet(notes_fts, 1, '>>>', '<<<', '...', 40) AS snippet,
      rank,
      n.tags
    FROM notes_fts
    JOIN notes n ON n.rowid = notes_fts.rowid
    WHERE notes_fts MATCH @query
  `;

  const params = { query: ftsQuery, limit };

  if (tag) {
    sql += ` AND n.tags LIKE @tag_pattern`;
    params.tag_pattern = `%${tag}%`;
  }

  if (path_prefix) {
    sql += ` AND n.path LIKE @path_prefix`;
    params.path_prefix = `${path_prefix}%`;
  }

  sql += ` ORDER BY rank LIMIT @limit`;

  try {
    return db.prepare(sql).all(params);
  } catch (e) {
    // If FTS query syntax is invalid, fall back to simple prefix match
    const fallback = `
      SELECT
        n.path,
        n.title,
        substr(n.body, 1, 200) AS snippet,
        0 AS rank,
        n.tags
      FROM notes n
      WHERE n.title LIKE @like_query OR n.body LIKE @like_query
      ${tag ? "AND n.tags LIKE @tag_pattern" : ""}
      ${path_prefix ? "AND n.path LIKE @path_prefix" : ""}
      LIMIT @limit
    `;
    params.like_query = `%${query}%`;
    return db.prepare(fallback).all(params);
  }
}

/**
 * Expand context from a seed note by following links.
 *
 * @param {string} notePath - path of the seed note
 * @param {object} options
 * @param {number} [options.depth=1] - how many hops to follow (1 or 2)
 * @param {number} [options.limit=20] - max notes to return
 * @returns {Array<{ path: string, title: string, relationship: string, snippet: string }>}
 */
export function expandContext(notePath, { depth = 1, limit = 20 } = {}) {
  const db = getDb();
  const results = [];
  const seen = new Set([notePath]);

  // Resolve path — the note might be referenced by title without path
  const resolvedPath = resolvePath(notePath);
  if (!resolvedPath) {
    return [{ path: notePath, title: notePath, relationship: "not_found", snippet: "" }];
  }

  // Get outgoing links (notes this note links to)
  const outgoing = db
    .prepare(
      `SELECT l.target, n.path, n.title, substr(n.body, 1, 200) as snippet
       FROM links l
       LEFT JOIN notes n ON (n.path LIKE '%' || l.target || '.md' OR n.title = l.target)
       WHERE l.source_path = ?`
    )
    .all(resolvedPath);

  for (const row of outgoing) {
    const targetPath = row.path || row.target;
    if (!seen.has(targetPath)) {
      seen.add(targetPath);
      results.push({
        path: targetPath,
        title: row.title || row.target,
        relationship: "outgoing_link",
        snippet: row.snippet || "",
      });
    }
  }

  // Get incoming links (notes that link to this note)
  const noteTitle = db.prepare("SELECT title FROM notes WHERE path = ?").get(resolvedPath)?.title;
  if (noteTitle) {
    const incoming = db
      .prepare(
        `SELECT n.path, n.title, substr(n.body, 1, 200) as snippet
         FROM links l
         JOIN notes n ON n.path = l.source_path
         WHERE l.target = ? OR l.target LIKE ?`
      )
      .all(noteTitle, `%/${noteTitle}`);

    for (const row of incoming) {
      if (!seen.has(row.path)) {
        seen.add(row.path);
        results.push({
          path: row.path,
          title: row.title,
          relationship: "incoming_link",
          snippet: row.snippet || "",
        });
      }
    }
  }

  // Depth 2: follow links from first-hop results
  if (depth >= 2) {
    const firstHopPaths = results.map((r) => r.path).filter((p) => p && !p.endsWith("not_found"));
    for (const hopPath of firstHopPaths) {
      if (results.length >= limit) break;
      const secondHop = db
        .prepare(
          `SELECT l.target, n.path, n.title, substr(n.body, 1, 150) as snippet
           FROM links l
           LEFT JOIN notes n ON (n.path LIKE '%' || l.target || '.md' OR n.title = l.target)
           WHERE l.source_path = ?
           LIMIT 5`
        )
        .all(hopPath);

      for (const row of secondHop) {
        if (results.length >= limit) break;
        const targetPath = row.path || row.target;
        if (!seen.has(targetPath)) {
          seen.add(targetPath);
          results.push({
            path: targetPath,
            title: row.title || row.target,
            relationship: "2nd_hop",
            snippet: row.snippet || "",
          });
        }
      }
    }
  }

  return results.slice(0, limit);
}

/**
 * High-level context assembly: search + expand + deduplicate.
 *
 * @param {string} topic - natural language topic
 * @param {object} options
 * @param {number} [options.limit=15] - max notes to return
 * @param {string} [options.path_prefix] - filter by path prefix
 * @returns {Array<{ path: string, title: string, relevance: string, snippet: string, tags: string }>}
 */
export function getContextForTopic(topic, { limit = 15, path_prefix } = {}) {
  const db = getDb();
  const results = new Map(); // path -> result object

  // Step 1: FTS search for direct matches
  const searchResults = searchVault(topic, { limit: Math.ceil(limit * 0.6), path_prefix });
  for (const r of searchResults) {
    results.set(r.path, {
      path: r.path,
      title: r.title,
      relevance: "direct_match",
      snippet: r.snippet,
      tags: r.tags,
    });
  }

  // Step 2: Expand from top results via link graph
  const topPaths = searchResults.slice(0, 3).map((r) => r.path);
  for (const seedPath of topPaths) {
    const expanded = expandContext(seedPath, { depth: 1, limit: 5 });
    for (const r of expanded) {
      if (!results.has(r.path) && r.relationship !== "not_found") {
        results.set(r.path, {
          path: r.path,
          title: r.title,
          relevance: `linked_from:${seedPath}`,
          snippet: r.snippet,
          tags: "",
        });
      }
    }
  }

  // Step 3: Tag-based expansion — if search results share tags, find siblings
  const tagCounts = {};
  for (const r of searchResults) {
    if (r.tags) {
      for (const t of r.tags.split(" ")) {
        if (t && !["active", "work", "personal"].includes(t)) {
          tagCounts[t] = (tagCounts[t] || 0) + 1;
        }
      }
    }
  }

  // Find the most common non-trivial tag
  const topTag = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .find(([tag]) => tag.length > 2)?.[0];

  if (topTag && results.size < limit) {
    const tagSiblings = db
      .prepare(
        `SELECT path, title, substr(body, 1, 150) as snippet, tags
         FROM notes
         WHERE tags LIKE ?
         ${path_prefix ? "AND path LIKE ?" : ""}
         LIMIT 5`
      )
      .all(
        `%${topTag}%`,
        ...(path_prefix ? [`${path_prefix}%`] : [])
      );

    for (const r of tagSiblings) {
      if (!results.has(r.path)) {
        results.set(r.path, {
          path: r.path,
          title: r.title,
          relevance: `shared_tag:${topTag}`,
          snippet: r.snippet,
          tags: r.tags,
        });
      }
    }
  }

  return [...results.values()].slice(0, limit);
}

/**
 * Get vault statistics.
 */
export function getStats() {
  const db = getDb();
  const noteCount = db.prepare("SELECT COUNT(*) as count FROM notes").get().count;
  const linkCount = db.prepare("SELECT COUNT(*) as count FROM links").get().count;
  const tagStats = db
    .prepare(
      `SELECT tags FROM notes WHERE tags != ''`
    )
    .all()
    .flatMap((r) => r.tags.split(" "))
    .reduce((acc, t) => {
      if (t) acc[t] = (acc[t] || 0) + 1;
      return acc;
    }, {});

  const topTags = Object.entries(tagStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([tag, count]) => ({ tag, count }));

  return { noteCount, linkCount, topTags };
}

// --- Helpers ---

function resolvePath(pathOrTitle) {
  const db = getDb();
  // Try exact path match
  const exact = db.prepare("SELECT path FROM notes WHERE path = ?").get(pathOrTitle);
  if (exact) return exact.path;

  // Try title match
  const byTitle = db.prepare("SELECT path FROM notes WHERE title = ?").get(pathOrTitle);
  if (byTitle) return byTitle.path;

  // Try partial path match
  const partial = db
    .prepare("SELECT path FROM notes WHERE path LIKE ?")
    .get(`%${pathOrTitle}%`);
  if (partial) return partial.path;

  return null;
}

function buildFtsQuery(query) {
  // If query already has FTS operators, pass through
  if (/["+*(){}]/.test(query) || /\b(AND|OR|NOT|NEAR)\b/.test(query)) {
    return query;
  }
  // Otherwise, treat as space-separated terms with implicit AND
  const terms = query
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .map((t) => `"${t}"`)
    .join(" ");
  return terms || `"${query}"`;
}
