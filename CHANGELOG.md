# Changelog

All notable changes to Engram are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-06-01

A performance and retrieval-quality release, informed by a survey of the agent-memory
field (Mem0, Letta, Zep/Graphiti, Cognee, LangMem, the official MCP memory server). See
[docs/PRIOR-ART.md](docs/PRIOR-ART.md) for the rationale and citations.

### Added

- **MCP server** (`@engram/mcp`). Exposes a vault to any MCP client (Claude Desktop,
  Claude Code, Cursor) as five tools — `engram_context`, `engram_recall`,
  `engram_remember`, `engram_reinforce`, `engram_stats`. `engram_recall` takes an
  `as_of` date for point-in-time queries.
- **`engram context`** and `packContext()` — token-budgeted, structured, recency-ordered
  retrieval for prompt injection: a capped block with tier, confidence, retention, id, and
  validity per entry, with near-duplicate suppression.
- **Tier-aware decay.** A per-tier stability ladder (`decay.tierStability`, default
  working 0.4 / episodic 1 / semantic 2.5 / procedural 8): `working` scratch fades in
  days, `procedural` rules are effectively permanent.
- **Lightweight bi-temporal memory.** Optional `valid_until` and `superseded_by`
  frontmatter; a `supersedes` link retires the target (marks it `deprecated`, stamps
  `superseded_by`) without deleting it. Expired and superseded memories drop out of recall
  unless explicitly requested.
- **Content-hash dedup on write.** Identical title+body reinforces the existing memory
  instead of writing a duplicate (`allowDuplicate` opts out).
- **Porter stemming** (`search.stemming`, default on) so word variants match.
- **Atomic writes** for memory files and the index (temp file + rename).

### Changed

- **Performance.** A cached in-process vault store (`Map`-indexed) and an in-process index
  cache replace the per-call full re-read. On a 2,000-memory vault: `getMemory` 402 ms →
  ~0 ms, `recall` 417 ms → ~9 ms, `reinforce ×3` 1,477 ms → ~0.2 ms.
- **Self-healing incremental index.** `ensureIndex` reconciles only changed/added/removed
  documents via per-file mtimes; writes no longer trigger a full rebuild.
- **BM25F retrieval.** Title, summary, and body are weighted fields with their own length
  normalization and a combined document frequency, replacing v0.1's title-repetition
  field boost. Weights live in `search.fieldWeights` (default title 5 / summary 2 / body 1).
- **Search excludes deprecated/superseded memories by default** (`includeDeprecated` to keep them).
- **12-character ids** (48 bits) for new memories; existing ids load unchanged.

### Notes

- Still single-user, local, offline by default, zero native dependencies.
- The index file format is v2; an existing v1 index is rebuilt automatically on first use.

## [0.1.0] - 2026-05-31

Initial public release. Engram is a local-first, markdown-native memory engine
for AI agents — single-user, offline by default, no telemetry.

### Added

- **Markdown vault.** Memories are `.md` files with YAML frontmatter across four
  tier directories (`working`, `episodic`, `semantic`, `procedural`).
  Frontmatter is serialized in a fixed canonical key order and tolerantly
  coerced on read, so hand-edited files still load.
- **Four cognitive tiers.** The tier is set in frontmatter, not by file location;
  `engram doctor` warns when the two disagree.
- **Ebbinghaus decay.** `retention = exp(-t / S)` with stability driven by
  `baseStability`, `strengthWeight`, and an importance factor. Pinning by
  `importance >= pinThreshold` or non-active status; auto-deprecation below
  `deprecateThreshold`. All tunable in `.engram/config.json`.
- **Reinforcement (spaced repetition).** `engram reinforce` bumps strength,
  resets the decay clock, and raises future stability.
- **Consolidation.** An offline pass that clusters aged, reinforced episodic
  memories by Jaccard similarity and synthesizes durable semantic memories with
  `informed_by` links back to their sources; sources are marked `consolidated`,
  not deleted.
- **Human-gated promotion.** `engram promote` is the only path into the
  procedural tier; there is no automatic semantic-to-procedural promotion.
- **BM25 search.** A pure-TypeScript inverted index persisted to
  `.engram/index.json`, with tier/type/status filters and snippet generation.
  Rebuildable from the markdown via `engram reindex`.
- **Recall.** An agent-facing retrieval entry that blends BM25 with retention and
  reinforcement to return the most useful memories.
- **Optional embeddings.** An `EmbeddingProvider` interface with an OpenAI
  provider gated on `OPENAI_API_KEY`, vector index build, and Reciprocal Rank
  Fusion of lexical and semantic ranks. Off by default; the default path makes
  no network calls.
- **Privacy scrub.** Bodies are redacted against configurable patterns before
  write, with conservative defaults for AWS keys, OpenAI-style secret keys,
  GitHub PATs, and PEM private-key headers.
- **CLI** (`engram`): `init`, `add`, `search`, `recall`, `reinforce`, `decay`,
  `consolidate`, `promote`, `status`, `reindex`, `doctor`, `panel`. Plain-text
  output by default, `--json` where it composes into a pipeline. `doctor` exits
  non-zero on integrity errors for CI use.
- **Local HTTP API.** A dependency-free `node:http` server bound to `127.0.0.1`
  exposing stats, memories, search, recall, graph, decay, runs, and `ops`
  mutation routes.
- **Control panel** (`@engram/panel`): a Vite + React SPA in a black/grey/red
  instrument-panel style — overview with a decay chart, a filterable memory
  table, a force-directed link graph, and a dry-run-then-apply operations view.

### Notes

- Single-user and local. No cloud sync, no auth, no multi-user vaults, no
  telemetry.
- `@engram/core` has zero native dependencies and runs on a clean machine with
  only Node ≥ 20.

[0.2.0]: https://github.com/blakestone-x/engram/releases/tag/v0.2.0
[0.1.0]: https://github.com/blakestone-x/engram/releases/tag/v0.1.0
