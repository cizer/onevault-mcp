import matter from "gray-matter";

// Extract wiki-links: [[target]] and [[target|alias]]
const WIKI_LINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

/**
 * Parse a markdown file's content into structured data.
 * @param {string} content - raw file content
 * @param {string} relativePath - path relative to vault root
 * @returns {{ title: string, frontmatter: object, body: string, links: string[], tags: string[] }}
 */
export function parseNote(content, relativePath) {
  let frontmatter = {};
  let body = content;

  try {
    const parsed = matter(content);
    frontmatter = parsed.data || {};
    body = parsed.content;
  } catch {
    // If frontmatter parsing fails, treat entire content as body
  }

  // Extract title: first H1, or frontmatter title, or filename
  let title = frontmatter.title || null;
  if (!title) {
    const h1Match = body.match(/^#\s+(.+)$/m);
    if (h1Match) {
      title = h1Match[1].trim();
    }
  }
  if (!title) {
    // Use filename without extension
    const parts = relativePath.split("/");
    title = parts[parts.length - 1].replace(/\.md$/, "");
  }

  // Extract wiki-links
  const links = [];
  let match;
  while ((match = WIKI_LINK_RE.exec(content)) !== null) {
    links.push(match[1].trim());
  }

  // Extract tags from frontmatter and inline
  let tags = [];
  if (frontmatter.tags) {
    if (Array.isArray(frontmatter.tags)) {
      tags = frontmatter.tags.map((t) => String(t).replace(/^#/, ""));
    } else if (typeof frontmatter.tags === "string") {
      tags = frontmatter.tags.split(/[,\s]+/).map((t) => t.replace(/^#/, ""));
    }
  }
  // Inline tags: #word (but not in code blocks)
  const inlineTags = body.match(/(?:^|\s)#([a-zA-Z][\w-/]*)/g) || [];
  for (const t of inlineTags) {
    const cleaned = t.trim().replace(/^#/, "");
    if (!tags.includes(cleaned)) {
      tags.push(cleaned);
    }
  }

  // Strip markdown formatting for cleaner FTS content
  const plainBody = stripMarkdown(body);

  return { title, frontmatter, body: plainBody, links, tags };
}

/**
 * Lightly strip markdown syntax for better FTS indexing.
 */
function stripMarkdown(text) {
  return (
    text
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, "")
      // Remove inline code
      .replace(/`[^`]+`/g, "")
      // Remove images
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      // Remove link syntax but keep text
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // Remove wiki-link syntax but keep text
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias || target)
      // Remove heading markers
      .replace(/^#{1,6}\s+/gm, "")
      // Remove bold/italic markers
      .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
      // Remove horizontal rules
      .replace(/^[-*_]{3,}$/gm, "")
      // Collapse whitespace
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
