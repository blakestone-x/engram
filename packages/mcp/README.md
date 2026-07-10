# @engram/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives any
MCP-capable agent — Claude Desktop, Claude Code, Cursor, and others — a tiered,
self-decaying long-term memory backed by an [Engram](../../README.md) vault.

The memory is plain markdown on disk. There is no vector database to run and no
service to host. An agent that calls `engram_context` before it acts and
`engram_remember` after it learns something gets durably better across sessions:
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
npm install
npm run build:lib
```

Then create a vault for the agent's memory:

```bash
node packages/cli/dist/index.js init ~/agent-memory
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

If you'd rather have a command on your PATH, run `npm i -g ./packages/mcp` from
the repo root. npm links the install back to the clone (keep the clone in
place), and the config becomes `"command": "engram-mcp"` with
`"args": ["--vault", "/absolute/path/to/agent-memory"]`.

### Cursor

Add an MCP server with command `node`, the same two args as above, and your
vault path. Or set `ENGRAM_VAULT` in the server's environment instead of
passing `--vault`.

## A suggested agent contract

Give your agent a short instruction:

> Before answering, call `engram_context` with the user's request. After you
> learn something durable — a decision, a fixed bug, a stable fact — call
> `engram_remember`. When a recalled memory was right, call `engram_reinforce`
> on it.

That loop is the whole idea. Retrieval stays lightweight (a bounded context
block, not the whole store), the vault grows as the agent works, and the
forgetting curve keeps it from drowning in stale notes.

## Maintenance

Run the decay and consolidation passes on a schedule (cron, a CI job, or by
hand) with the Engram CLI (`npm i -g ./packages/cli` from the repo root):

```bash
engram decay --apply        # deprecate memories that fell below retention threshold
engram consolidate --apply  # promote clustered episodic memories into semantic ones
```

MIT licensed. Part of the [Engram](../../README.md) project.
