# OneVault MCP Server

MCP server providing semantic search over your Obsidian vault via SQLite FTS5 and wiki-link graph traversal.

## Status

✅ Server implemented and tested  
✅ Database indexed (818 notes, 2,114 links)  
❌ **Not yet working with Claude Code CLI** — user-defined MCP servers in `~/.claude/mcp.json` may not be supported by the CLI (v2.1.140)

## What Works

- Full-text search with FTS5 ranking
- Wiki-link graph traversal (1-2 hops)
- Topic context assembly (search + links + tags)
- Incremental filesystem watching
- Tested manually via stdio

## Next Steps

### Option 1: Use Desktop App (Recommended)

Claude Code Desktop app reads MCP config from:
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

Add the onevault server there:
```json
{
  "mcpServers": {
    "onevault": {
      "command": "/Users/richie.mackay/Projects/onevault-mcp/src/index.js",
      "args": [],
      "env": {
        "VAULT_PATH": "/Users/richie.mackay/Documents/OneVault",
        "DB_PATH": "/Users/richie.mackay/Projects/onevault-mcp/vault.db",
        "EXCLUDE_DIRS": ".obsidian,.trash,obsidian-inbox-processor/.venv,assets"
      }
    }
  }
}
```

Then restart the desktop app.

### Option 2: Package as a Plugin

Wrap the MCP server in a Claude Code plugin with an `.mcp.json` manifest. Plugins can register MCP servers that the CLI will load.

1. Create `.claude-plugin/` directory structure
2. Add `manifest.json` with plugin metadata
3. Add `.mcp.json` with server definition
4. Install via local marketplace

### Option 3: Wait for CLI MCP Support

The CLI may add support for `~/.claude/mcp.json` in a future release.

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

## Technical Details

- **Index**: SQLite FTS5 with Porter stemming
- **Parser**: gray-matter for frontmatter, custom wiki-link extraction
- **Watcher**: chokidar for incremental updates
- **Protocol**: MCP SDK 1.29.0 over stdio transport

## Repo Structure

```
~/Projects/onevault-mcp/        ← git repo (version controlled)
├── src/
│   ├── index.js               ← MCP server entry point
│   ├── config.js              ← Environment configuration
│   ├── db.js                  ← SQLite schema and connection
│   ├── indexer.js             ← Full & incremental indexing
│   ├── parser.js              ← Markdown + frontmatter parser
│   ├── search.js              ← FTS5 + link graph queries
│   └── watcher.js             ← Filesystem watcher
├── package.json
├── .env                        ← Vault path config (gitignored)
└── vault.db                    ← SQLite index (gitignored)
```

Vault itself (`~/Documents/OneVault/`) is **not under version control** — only the tooling is tracked.
