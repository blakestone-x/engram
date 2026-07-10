# Engram

[![CI](https://github.com/blakestone-x/engram/actions/workflows/ci.yml/badge.svg)](https://github.com/blakestone-x/engram/actions/workflows/ci.yml)

Most AI agents are amnesiacs. Every session starts from zero. You explain your setup, your conventions, the mistake you don't want repeated, and the next day you explain all of it again. For a one-off task that's fine. For an agent you work with every day, it's the ceiling. Engram gives an agent a long-term memory it keeps between sessions: plain markdown files on your disk, ranked at recall time by relevance blended with how well each memory has held up. Memories fade unless the agent keeps using them, and old episodes consolidate into durable knowledge.

## Design

Memory is organized in four tiers:

- **`working`** is the live session: scratch notes that churn and fade in days.
- **`episodic`** is the searchable log of what happened.
- **`semantic`** is distilled truth lifted out of episodes.
- **`procedural`** is the how-to steps that worked, committed deliberately and close to permanent.

The rationale: human memory already solved this. Cognitive psychology separates these four kinds of memory because each holds a different kind of knowledge for a different length of time. Engram borrows the structure and the stability schedule. A memory's tier is a frontmatter field, and it scales the memory's half-life (defaults: working 0.4x, episodic 1x, semantic 2.5x, procedural 8x), so a scratch note is gone in days while an operating rule effectively never decays.

## Consolidation and forgetting

The forgetting is the feature. A store that never forgets gets worse as it fills: a stale fact from three months ago ranks next to one written this morning, and recall quality erodes. Engram gives every memory a half-life instead.

**Decay.** Retention follows the Ebbinghaus forgetting curve:

```
retention = exp(-t / S)
S = baseStability · (1 + strengthWeight · strength) · importanceFactor · tierFactor
```

where `t` is days since the memory was last reinforced (or created). When an unpinned memory's retention falls below the deprecate threshold, the decay pass marks it `deprecated`. Deprecated memories drop out of recall but stay on disk, so forgetting means "stop surfacing this," not "destroy it." The full derivation with worked examples is in [docs/MEMORY-MODEL.md](docs/MEMORY-MODEL.md).

**Reinforcement.** When a recalled memory proves useful, reinforcing it resets its decay clock and raises its strength, which raises its future stability. This is spaced repetition: memory the agent keeps using becomes progressively harder to forget, and the rest fades on schedule.

**Consolidation.** A background pass that runs like sleep. It gathers aged, reinforced episodic memories, clusters them by token overlap, and writes one durable semantic memory per cluster, with `informed_by` links back to every source. Sources are marked `consolidated`, not deleted, so the trail stays intact. Promotion past semantic (to a procedural rule) is human-invoked on purpose, via `engram promote`.

Both passes are dry-run by default and take `--apply`. Run them on a cron and the store maintains itself.

## Quickstart

The packages aren't published to npm yet, so everything installs from a clone:

```bash
git clone https://github.com/blakestone-x/engram
cd engram
npm install
npm run build:lib        # builds @engram/core, the engram CLI, and @engram/mcp
```

Run the CLI from the built output, or install the `engram` binary globally (npm links it back to the clone, so keep the clone in place):

```bash
node packages/cli/dist/index.js init my-vault
# or
npm i -g ./packages/cli
engram init my-vault
```

Every command walks up from the current directory to find the nearest vault, so inside `my-vault/` no flags are needed. A short session:

```bash
$ engram add -t "Customer prefers email over phone" --tier episodic \
    --type observation --importance 6 --tags contact,acme \
    -b "Confirmed on the 5/30 call. Phone goes to voicemail; email gets a same-day reply."
Added 79c338447a1e  episodic/2026-07-10-customer-prefers-email-over-phone-79c338447a1e.md

$ engram recall how to reach the customer
0.50  Customer prefers email over phone [episodic] 99% ×0

$ engram reinforce 79c338447a1e
Reinforced 79c338447a1e  Customer prefers email over phone  → strength 1
```

`recall` reports each hit's retention and reinforcement count (`×0` means never reinforced). For prompt assembly, `context` is recall with a token budget; it returns a compact markdown block that drops straight into a prompt:

```bash
$ engram context "how should we reach this customer" --budget 800
# Recalled memory for: how should we reach this customer

- [episodic·medium·99%] Customer prefers email over phone: Confirmed on the 5/30 call. Phone goes to voicemail; email gets a same-day reply. (id 79c338447a1e)

  1 memories · ~54 tokens
```

The maintenance passes preview before they touch anything. Against the populated example vault in [examples/starter-vault](examples/starter-vault):

```bash
$ engram decay
Evaluated 14 · forgettable 5 · dry-run (use --apply)
  0%  Redis caching experiment notes [working] c9d0e1f2
  ...

$ engram consolidate
Eligible 6 · clusters 1 · dry-run (use --apply)
  cluster 1: 4 sources · checkout, timeout, gateway, client, circuit, breaker
```

`engram status` summarizes the vault, `engram doctor` exits non-zero on integrity errors (usable as a CI gate on a vault in git), and `engram panel` serves a local web UI on `127.0.0.1`. The panel UI needs the full `npm run build`; the quickstart's `build:lib` skips it.

## MCP server

`@engram/mcp` is a stdio [Model Context Protocol](https://modelcontextprotocol.io) server. Point it at a vault and any MCP client (Claude Desktop, Claude Code, Cursor) gets five tools:

| Tool | The agent calls it to |
|------|-----------------------|
| `engram_context` | pull a token-budgeted block of relevant memory before acting |
| `engram_recall` | get ranked hits (relevance blended with retention and reinforcement) |
| `engram_remember` | write a new memory after learning something |
| `engram_reinforce` | mark a recalled memory as useful so it stays sharp |
| `engram_stats` | read vault size, per-tier counts, and what is decaying soon |

**Install.** Build from the clone as in the quickstart (`npm install && npm run build:lib`), create a vault, then point your MCP config (`claude_desktop_config.json`, or `.mcp.json` for Claude Code) at the built server:

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

If you'd rather have a command on your PATH, `npm i -g ./packages/mcp` from the repo root installs an `engram-mcp` binary (linked to the clone), and the config becomes `"command": "engram-mcp"` with `"args": ["--vault", "..."]`.

The server resolves its vault from `--vault`, then the `ENGRAM_VAULT` environment variable, then the nearest vault above the working directory. Logs go to stderr; stdout carries only the protocol.

Then give the agent one instruction: call `engram_context` before acting, `engram_remember` after learning something durable, `engram_reinforce` when a recalled memory was right. That loop is the whole idea. See [packages/mcp/README.md](packages/mcp/README.md) for details.

## Architecture notes

Four packages in an npm workspace: `@engram/core` (the engine), `engram` (the CLI), `@engram/mcp` (the MCP server), `@engram/panel` (a Vite + React control panel served by the engine's `node:http` API). The engine is pure TypeScript with no native dependencies; it runs on a clean machine with Node 20 or later. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) has the module map.

**Local-first.** Nothing leaves the machine on the default path. There are no network calls unless you explicitly configure an embedding provider, and the panel binds to `127.0.0.1` only.

**Markdown-native.** Each memory is one `.md` file with YAML frontmatter in a fixed key order:

```markdown
---
id: 79c338447a1e
title: Customer prefers email over phone
tier: episodic
type: observation
status: active
confidence: medium
importance: 6
strength: 1
created: 2026-07-10
last_reviewed: 2026-07-10
last_reinforced: 2026-07-10
tags:
  - contact
  - acme
summary: Email gets a same-day reply; phone goes to voicemail.
---

Confirmed on the 5/30 call. Phone goes to voicemail; email gets a same-day reply.
```

Only `title` and `tier` are required on write; the rest is defaulted. You can read, `grep`, hand-edit, and git-diff your agent's memory. The search index in `.engram/index.json` and any vectors are derived and rebuildable (`engram reindex`), so deleting `.engram/` costs speed, not data.

**Retrieval.** A pure-TypeScript inverted index with BM25F field weighting (title, summary, and body get separate weights and length normalization, with optional Porter stemming). `recall` blends the lexical score with each memory's current retention and strength, so a durable, frequently used memory outranks a fading one that happens to share more words. `context` packs recall results into a token budget. If you configure an embedding provider (`engram vectors`, reads `OPENAI_API_KEY` from a `.env` at the vault root; keep that file out of git), search fuses lexical and vector ranks with Reciprocal Rank Fusion; with no provider, none of that code runs.

**Write-time gating.** Before a memory is written, its body passes through a redaction filter: matches of the vault's `redactPatterns` become `[REDACTED]`. The defaults catch AWS keys, OpenAI-style secret keys, GitHub tokens, and PEM private-key headers. Writes also dedup by content hash: adding a memory with an identical title and body reinforces the existing one instead of storing a duplicate.

Beyond the basics: supersession links retire a changed fact without deleting it (`recall --as-of <date>` answers "what was known then"), and optional `scope`/`author`/`visibility` frontmatter lets multiple agents share one vault without contaminating each other ([docs/MULTI-AGENT.md](docs/MULTI-AGENT.md)). The control panel gives you a live decay chart, a link graph, and dry-run previews of the maintenance passes:

![Engram control panel](docs/panel.png)

## Provenance

Engram is extracted from a production memory system running inside a national commercial field-service operation, where a fleet of coding agents uses it daily to carry knowledge across sessions. What carried over is the mechanism: the tiers, the decay math, reinforcement, consolidation, and the markdown-as-source-of-truth decision. The domain content, schemas, and integrations stayed behind. [docs/HISTORY.md](docs/HISTORY.md) tells the longer story, and [docs/PRIOR-ART.md](docs/PRIOR-ART.md) places the design against the wider agent-memory field.

## Status and roadmap

v0.3. Local-first, single-user, no cloud sync, no auth, no telemetry. Not yet published to npm, so install from a clone as shown above. The engine, CLI, MCP server, and panel all build and run from a fresh checkout; 42 tests cover the decay math, consolidation, search, frontmatter handling, multi-agent scoping, and integrity checks.

Working today: the tiered model with tier-aware decay, reinforcement, consolidation, supersession with as-of recall, BM25F search with optional hybrid embeddings, content-hash dedup, write-time redaction, the CLI, the MCP server, the control panel, multi-agent namespacing, and JSON-Lines export/import. Not built: hosted sync, a multi-tenant service, and automatic semantic-to-procedural promotion, which stays human-gated on purpose.

## License

MIT. See [LICENSE](./LICENSE).

## Docs

- [docs/MEMORY-MODEL.md](docs/MEMORY-MODEL.md): the cognitive model and the decay math, with worked examples.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the module map for contributors.
- [docs/MULTI-AGENT.md](docs/MULTI-AGENT.md): namespacing, shared vaults, and git as the sync layer.
- [docs/PRIOR-ART.md](docs/PRIOR-ART.md): design rationale against the agent-memory field, with citations.
- [docs/HISTORY.md](docs/HISTORY.md): how Engram came to be.
