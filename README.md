# OneVault MCP Server

![OneVault MCP Hero](assets/hero.svg)

MCP server providing fast search and context assembly over Markdown knowledge bases via SQLite FTS5, frontmatter parsing, tags, and link graph traversal.

It works well for Obsidian vaults, docs repositories, ADR/RFC collections, static-site content, and other Markdown-heavy corpora. Obsidian is the first-class profile: wiki links such as `[[Note Title]]`, note-style tags, and `.obsidian` exclusions are supported out of the box.

## Installation

```bash
git clone https://github.com/cizer/onevault-mcp.git
cd onevault-mcp
npm install
cp .env.example .env
# Edit .env with your Markdown corpus path
npm run build-index
```

## Features

- Full-text search with FTS5 ranking
- Wiki-link graph traversal (1-2 hops), with Obsidian-style links supported
- Topic context assembly (search + links + tags)
- Incremental filesystem watching
- Tested manually via stdio

## Configuration

### Codex CLI / Codex Desktop

Register this MCP server with Codex as a local stdio server:

```bash
codex mcp add onevault \
  --env VAULT_PATH=/path/to/your/MarkdownCorpus \
  --env DB_PATH=/path/to/your/MarkdownCorpus/.onevault-mcp/corpus.db \
  --env EXCLUDE_DIRS=.obsidian,.trash \
  -- node /path/to/onevault-mcp/src/index.js
```

Verify the registration:

```bash
codex mcp list
codex mcp get onevault
```

Codex reads this from `~/.codex/config.toml`. Restart Codex after adding or changing the server so the new tools are loaded into the session.

Keep `VAULT_PATH` pointed at your Markdown corpus root. Store `DB_PATH` outside version control, for example in a `.onevault-mcp/` directory inside the corpus. The `VAULT_PATH` name is retained for compatibility, but it can point at any Markdown folder.

### Claude Code CLI

Add to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "onevault": {
      "command": "/path/to/onevault-mcp/src/index.js",
      "args": [],
      "env": {
        "VAULT_PATH": "/path/to/your/MarkdownCorpus",
        "DB_PATH": "/path/to/your/MarkdownCorpus/.onevault-mcp/corpus.db",
        "EXCLUDE_DIRS": ".obsidian,.trash"
      }
    }
  }
}
```

**Note**: Configuration must be in `~/.claude/mcp.json`, not `~/.claude.json`.

### Claude Code Desktop App

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "onevault": {
      "command": "/path/to/onevault-mcp/src/index.js",
      "args": [],
      "env": {
        "VAULT_PATH": "/path/to/your/MarkdownCorpus",
        "DB_PATH": "/path/to/your/MarkdownCorpus/.onevault-mcp/corpus.db",
        "EXCLUDE_DIRS": ".obsidian,.trash"
      }
    }
  }
}
```

Then restart Claude Code.

## Manual Testing

```bash
# Build index
npm run build-index

# Start server (stdio mode)
npm start

# Test search directly
node -e "
import { searchVault, getContextForTopic } from './src/search.js';
console.log(searchVault('cross-VS dependencies', { limit: 5 }));
console.log(getContextForTopic('AI agent orchestration risks', { limit: 8 }));
"
```

## Tools Provided

| Tool | Purpose |
|---|---|
| `search_vault` | Keyword search with ranked snippets, filterable by tag/path |
| `expand_context` | Follow links 1-2 hops from a seed note |
| `get_context_for_topic` | Assemble context bundle (search + links + tag siblings) |
| `vault_stats` | Index health check |
| `reindex_vault` | Force full rebuild |

Tool names still use `vault` for compatibility with existing clients. Treat `vault` as "the configured Markdown corpus."

## Obsidian Support

OneVault has first-class support for Obsidian vaults:

- Wiki links such as `[[Note Title]]` and `[[Note Title|Alias]]`
- Frontmatter and inline tags
- Common Obsidian exclusions like `.obsidian` and `.trash`
- Link graph expansion across note titles and paths

For non-Obsidian Markdown corpora, full-text search, tags, path filtering, and frontmatter parsing still work. Link graph quality depends on whether your corpus uses wiki-style links.

## Technical Details

- **Index**: SQLite FTS5 with Porter stemming
- **Parser**: gray-matter for frontmatter, custom wiki-link extraction
- **Watcher**: chokidar for incremental updates
- **Protocol**: MCP SDK 1.29.0 over stdio transport

## Repo Structure

```
onevault-mcp/                   ← git repo (version controlled)
├── src/
│   ├── index.js               ← MCP server entry point
│   ├── config.js              ← Environment configuration
│   ├── db.js                  ← SQLite schema and connection
│   ├── indexer.js             ← Full & incremental indexing
│   ├── parser.js              ← Markdown + frontmatter parser
│   ├── search.js              ← FTS5 + link graph queries
│   └── watcher.js             ← Filesystem watcher
├── package.json
├── .env.example               ← Template for environment variables
├── .env                       ← Your corpus path config (gitignored)
└── vault.db                   ← SQLite index (gitignored)
```

Your Markdown corpus is **not under version control** by this project — only the indexing tooling is tracked.
