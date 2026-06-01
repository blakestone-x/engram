# Architecture

This is the contributor's map of Engram: what each module does, how data moves through the engine, and where the CLI and panel sit relative to the core.

## Packages

Three packages in an npm workspace (`packages/*`):

- **`@engram/core`** — the engine. All vault IO, the search index, decay, consolidation, recall, the optional embedding layer, and the HTTP API. Pure TypeScript, ESM, no native dependencies. Depends only on `gray-matter`, `yaml`, and `zod`.
- **`engram`** (`packages/cli`) — the command-line interface. A thin wrapper over `@engram/core` using `commander`, `picocolors`, and `cli-table3`. It holds no engine logic; every command resolves a vault and calls into core.
- **`@engram/panel`** — the Vite + React control panel. A static SPA that talks to the core HTTP API and nothing else. Built to a `dist/` that core can serve.

## The `@engram/core` module map

One line each, in roughly dependency order. The barrel is `src/index.ts`.

| Module | Responsibility |
|---|---|
| `types.ts` | The authoritative shape of every value crossing a module boundary — `Memory`, `Frontmatter`, `Tier`, config interfaces, search/decay/consolidation result types. Everything imports from here. |
| `config.ts` | `EngramConfig` defaults (`DEFAULT_CONFIG`), zod validation, and load/save of `.engram/config.json` with partial-config merge over defaults. |
| `frontmatter.ts` | Parse and serialize memory frontmatter with a fixed canonical key order; tolerant coercion that fills defaults for missing or hand-edited fields; id generation. |
| `privacy.ts` | The redaction scrub — replaces matches of the vault's `redactPatterns` with `[REDACTED]` before a body is written. Invalid patterns are skipped, never thrown. |
| `vault.ts` | The filesystem layer over the store: init/open a vault, read/write memories (atomic writes), `addMemory` (content-hash dedup + supersession), `updateMemory`, `reinforce`, and the jsonl run log. |
| `store.ts` | The cached vault store: loads memories once per process into `Map<id>`/`Map<path>`, serves O(1) lookups, keeps the cache coherent on write, and `refreshStore` re-scans for external edits. |
| `dates.ts` | ISO `YYYY-MM-DD` helpers and `elapsedDays` — the day arithmetic the decay clock reads. |
| `tokens.ts` | The single tokenizer shared by search and consolidation, plus Jaccard similarity and optional Porter stemming. One notion of "a word" for both "matches the query" and "similar enough to cluster." |
| `stemmer.ts` | A vendored Porter stemmer applied identically to indexed text and queries when `search.stemming` is on. |
| `decay.ts` | The forgetting curve: `retentionFor`, `stabilityFor` (tier- and reinforcement-scaled), `importanceFactor`, `tierFactor`, `isPinned`, `isExpired`, `daysUntilDeprecate`, `decayReport`, and the `runDecay` pass. Pure given a clock. |
| `consolidate.ts` | The consolidation pass: gather eligible episodic memories, cluster by Jaccard, synthesize one semantic memory per kept cluster, mark sources `consolidated`. |
| `search.ts` | The pure-TypeScript inverted index and **BM25F** field-weighted ranking, persisted to `.engram/index.json` and cached in process; `buildIndex`, `ensureIndex` (self-healing incremental reconcile by mtime), `search` with filters, default deprecated exclusion, and snippet generation. |
| `recall.ts` | The agent-facing retrieval entry: BM25 blended with retention and reinforcement so recall returns the most useful memories rather than the most lexically similar. |
| `context.ts` | `packContext` — token-budgeted retrieval that formats a compact markdown block of the top memories for prompt injection; `estimateTokens`. |
| `embeddings.ts` | The optional semantic layer: an `EmbeddingProvider` interface, an OpenAI provider gated on `OPENAI_API_KEY`, vector build, cosine, and Reciprocal Rank Fusion of lexical and semantic ranks. No-op without a configured provider. |
| `stats.ts` | `vaultStats` — counts by tier and status, average retention, the decaying-soon count, and recently-reinforced memories. Feeds the CLI `status` and the panel overview. |
| `graph.ts` | `buildGraph` — nodes (id, title, tier, strength, retention) and typed edges from frontmatter `links`, for the panel's force-directed view. |
| `doctor.ts` | Integrity checks: duplicate ids, missing title/summary, tier-directory mismatch, unknown type, broken links, out-of-range importance. Errors fail; warnings do not. |
| `server.ts` | The `node:http` API bound to loopback — the JSON routes the panel consumes, plus optional static serving of the built panel SPA with an index.html fallback. |

## Data flow

The markdown files are the source of truth; everything else is derived in memory or in `.engram/`.

```
my-vault/
  working/ episodic/ semantic/ procedural/   ← .md files (canonical)
  .engram/
    config.json     ← user config, merged over DEFAULT_CONFIG
    index.json      ← derived BM25 index (rebuildable)
    vectors.json    ← derived, only if an embedding provider is set
    runs/runs.jsonl ← append-only run log
```

A read flows like this:

```
.md files
  → vault.listMemories()        walk tier dirs, read each file
  → frontmatter.parseFrontmatter()   gray-matter split, coerce + default
  → Memory[]                    in-memory array of { frontmatter, body, path, absPath }
```

From that `Memory[]`, the engine derives whatever a caller needs without writing anything: `decayReport` computes retention per memory, `vaultStats` aggregates, `buildGraph` walks links, `recall` blends scores. The one persisted derivation is the search index — `buildIndex` tokenizes every memory's title, summary, and body and writes `index.json`; `search` loads it (rebuilding if missing or a stale version).

A write flows the other way. `addMemory` builds frontmatter from input, runs the body through the privacy scrub, picks a path (`<tier>/<date>-<slug>-<id>.md`), and serializes with the canonical key order. `reinforce`, `runDecay --apply`, and `runConsolidation --apply` all mutate frontmatter and rewrite files, then append an event to the run log. After any write that changes the corpus, the index is rebuilt.

There is no in-process state between commands. Each CLI invocation re-reads the vault from disk, which keeps the model simple and means a hand-edit to a `.md` file is picked up on the next command with no cache to invalidate.

## How the CLI sits on top

`packages/cli/src/index.ts` is a `commander` program. Each command resolves a vault — either the `--dir` you pass or the nearest one found by walking up from the cwd (`findVaultRoot`) — then calls a single core function and formats the result. Output is plain text by default and JSON under `--json` where it composes into an agent pipeline. The CLI imports only from the `@engram/core` barrel; it never reaches into core internals.

## How the panel sits on top

`engram panel` calls `createServer(vault, { staticDir })` from core and binds it to `127.0.0.1`. The server exposes the engine as JSON (`/api/stats`, `/api/memories`, `/api/search`, `/api/recall`, `/api/graph`, `/api/decay`, `/api/runs`, and the `/api/ops/*` mutation routes) and, when a `staticDir` is set, serves the built panel SPA for any non-`/api` GET with an index.html fallback. The panel is a pure client of that API — it has no direct filesystem access and no engine logic of its own. In development, Vite serves the React app and proxies `/api` to a separately running core server on loopback:4319.
