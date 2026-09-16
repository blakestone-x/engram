# @engram/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives any
MCP-capable agent — Claude Desktop, Claude Code, Cursor, and others — a tiered,
self-decaying long-term memory backed by an [Engram](../../README.md) vault.

The memory is plain markdown on disk. There is no vector database to run and no
service to host. An agent that calls `engram_context` before it acts and
`engram_remember` after it learns something can reuse that knowledge across sessions:
what it keeps using stays sharp, what it stops using fades.

## Tools

| Tool | When the agent calls it |
|------|--------------------------|
| `engram_context` | Before acting — pull a token-budgeted block of the most relevant memories, formatted to drop straight into the prompt. |
| `engram_recall` | When it wants ranked hits (relevance blended with retention and reinforcement) rather than a packed block. |
| `engram_remember` | After learning a fact, decision, error+fix, or observation worth keeping. |
| `engram_reinforce` | When a recalled memory proved useful — raises its strength and resets its forgetting curve. |
| `engram_stats` | To see vault size, per-tier counts, average retention, and what is decaying soon. |

## Setup

The package isn't published to npm yet, so build it from a clone of the monorepo:

```bash
git clone https://github.com/blakestone-x/engram
cd engram
npm ci
npm run build:lib
```

Then create a vault for the agent's memory:

```bash
node packages/cli/dist/index.js init ../agent-memory
```

The server resolves its vault from, in order: a `--vault <dir>` flag, the
`ENGRAM_VAULT` environment variable, or the nearest vault above the working
directory.

### Claude Desktop / Claude Code

Add to your MCP config (`claude_desktop_config.json` or `.mcp.json`), pointing
at the built server inside your clone:

```json
{
  "mcpServers": {
    "engram": {
      "command": "node",
      "args": [
        "/absolute/path/to/engram/packages/mcp/dist/index.js",
        "--vault", "/absolute/path/to/agent-memory"
      ]
    }
  }
}
```

Keep the clone and built output in place: the configuration runs that local server directly.

### Cursor

Add an MCP server with command `node`, the server script path, `--vault`, and the vault path as the three arguments above. Or set `ENGRAM_VAULT` in the server's environment instead of
passing `--vault`.

Use absolute paths in client configuration. On Windows, JSON paths can use forward slashes (for example, `C:/dev/engram/packages/mcp/dist/index.js`).

## A suggested agent contract

Give your agent a short instruction:

> Before answering, call `engram_context` with the user's request. After you
> learn something durable — a decision, a fixed bug, a stable fact — call
> `engram_remember`. When a recalled memory was right, call `engram_reinforce`
> on it.

That loop is the whole idea. Retrieval stays lightweight (a bounded context
block, not the whole store), the vault grows as the agent works, and the
forgetting curve keeps it from drowning in stale notes.

## Scope and trust

`engram_context` and `engram_recall` accept a `scope` filter; `engram_remember` can store one. `engram_stats` is vault-wide and `engram_reinforce` addresses a memory by ID without a scope check. An omitted query scope sees all namespaces. Use these tools with trusted agents; scopes are not access controls.

Context budgets are approximate character-based estimates; the first result may exceed the requested budget. The `as_of` option evaluates retention and expiry at a supplied date but does not reconstruct past memory contents or status. See [the memory model](../../docs/MEMORY-MODEL.md).

## Maintenance

Run the decay and consolidation passes on a schedule (cron, a CI job, or by
hand) with the built Engram CLI from the repository root:

```bash
node packages/cli/dist/index.js consolidate --dir ../agent-memory
node packages/cli/dist/index.js decay --dir ../agent-memory
# After reviewing the previews:
node packages/cli/dist/index.js consolidate --apply --dir ../agent-memory
node packages/cli/dist/index.js decay --apply --dir ../agent-memory
```

MIT licensed. Part of the [Engram](../../README.md) project.
