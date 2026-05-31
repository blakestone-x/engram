# Engram — Build Spec (internal contract)

> Internal engineering spec — the single source of truth for how the engine behaves.
> Public docs live in `docs/`. If the code and this file disagree, treat it as a bug:
> fix the code or update the spec in the same change, and say which.

Engram is a local-first, markdown-native memory framework for AI agents. Memories are
plain `.md` files with YAML frontmatter. A rebuildable JSON index sits beside them. The
engine adds three things a folder of notes cannot do on its own:

1. **Tiered memory** — `working → episodic → semantic → procedural`, mirroring human memory.
2. **Ebbinghaus decay** — memories lose retention on a forgetting curve unless referenced.
   Recall reinforces them (spaced repetition); unreferenced, low-value memories fade and
   are auto-deprecated.
3. **Consolidation** — aged, reinforced episodic memories cluster by similarity and promote
   into durable semantic memories, the way sleep consolidates the day's experiences.

Design rules:
- **Markdown is the source of truth.** Everything else (index, vectors) is derived and
  rebuildable from the `.md` files alone. Deleting `.engram/` must lose nothing but speed.
- **Zero native dependencies in `@engram/core`.** Pure TypeScript. No better-sqlite3, no
  native addons. `npx engram` must work on a clean machine with only Node ≥ 20.
- **Config over hardcode.** No domain-specific enums baked in. Tiers are fixed (they are
  the cognitive model); types/tags/domains are user config.
- **Privacy by default.** A scrub pass strips obvious secrets before write; nothing leaves
  the machine unless the user wires an embedding provider.

---

## Monorepo layout

```
engram/
  package.json            # npm workspaces root
  tsconfig.base.json
  LICENSE                 # MIT, Blake Stone
  README.md               # public face
  CHANGELOG.md
  CONTRIBUTING.md
  SPEC.md                 # this file (internal)
  .github/workflows/ci.yml
  docs/
    MEMORY-MODEL.md        # the cognitive model + decay math (public)
    HISTORY.md             # how Engram was built (public narrative)
    ARCHITECTURE.md        # module map for contributors
  packages/
    core/    @engram/core  # engine: vault IO, index, decay, consolidation, retrieval, http api
    cli/     engram (bin)   # CLI over core
    panel/   @engram/panel  # Vite+React control panel (black/grey/red), built to static dist
  examples/
    starter-vault/         # a runnable sample vault of .md memories
```

Package manager: **npm workspaces** (ships with Node, no extra tool to install).
Language: **TypeScript, ESM, `"type": "module"`, target ES2022, NodeNext resolution.**
Node engines: `>=20`.

Dependency budget:
- `@engram/core`: `gray-matter` (frontmatter), `yaml` (writes), `zod` (config/frontmatter
  validation). Nothing native. No web framework — the HTTP server uses `node:http`.
- `engram` CLI: `@engram/core`, `commander`, `picocolors`, `cli-table3` (status dashboard).
- `@engram/panel`: `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `d3-force` (graph),
  `recharts` or hand-rolled SVG for the decay chart. No CSS framework — hand-written CSS
  with the theme tokens below.

---

## Data model

A **memory** is one `.md` file inside a **vault**. The vault root holds tier directories:

```
my-vault/
  .engram/
    config.json
    index.json          # derived BM25 index
    vectors.json        # derived, only if an embedding provider is configured
    runs/               # decay/consolidation run logs (jsonl)
  working/
  episodic/
  semantic/
  procedural/
```

Memories may be nested in subfolders within a tier directory; the tier is determined by the
**frontmatter `tier` field**, not the path (path is organizational only). `engram doctor`
warns if a file's tier dir and frontmatter tier disagree.

### Frontmatter schema (authoritative)

```yaml
---
id: 0c5f1e7a            # stable 8-char id, generated on add, never changes
title: "Short title"
tier: working           # working | episodic | semantic | procedural
type: note              # note | fact | decision | error | reference | observation (configurable list)
status: active          # active | consolidated | deprecated | disputed
confidence: medium      # high | medium | low
importance: 5           # 1-10 integer; >= pinThreshold (default 8) never decays
strength: 0             # reinforcement count (>=0 integer)
created: 2026-05-31      # ISO date
last_reviewed: 2026-05-31
last_reinforced: 2026-05-31   # the decay clock reads from here; reinforce resets it
tags: [example]
links:                  # typed relations to other memories
  - to: 9a2b1c3d        # target memory id (preferred) or relative path
    rel: related        # extends | informed_by | contradicts | related | supersedes
summary: "One-line summary for progressive disclosure / search snippets."
---

Markdown body. Free-form.
```

Required on write: `title`, `tier`. Everything else is defaulted by `normalizeFrontmatter`
(see types). `id` is generated if absent. Dates default to today.

---

## The decay model (showcase — implement exactly)

Continuous Ebbinghaus forgetting curve. For a memory `m` at evaluation time `now`:

```
elapsedDays = max(0, daysBetween(m.last_reinforced ?? m.created, now))
stability   = baseStability * (1 + strengthWeight * m.strength) * importanceFactor(m.importance)
retention   = exp(-elapsedDays / stability)        // ∈ (0, 1], 1 = perfectly retained
```

- `importanceFactor(i) = 1 + importanceWeight * (i - 5)` clamped to a floor of `0.25`.
  (importance 5 is neutral; higher slows decay, lower speeds it.)
- `baseStability` default **14** (days), `strengthWeight` default **0.8**, `importanceWeight`
  default **0.15**. All in config under `decay`.

**Pinning:** if `m.importance >= pinThreshold` (default **8**) OR `m.status !== 'active'`,
retention is reported but the memory is exempt from auto-deprecation.

**Decay pass** (`runDecay`):
- Compute `retention` for every active memory.
- A memory is **forgettable** if `active && importance < pinThreshold && retention < deprecateThreshold`
  (default **0.15**).
- In `--apply` mode: set forgettable memories to `status: deprecated`, append a `decay`
  event to the run log, and rewrite the file. Dry-run (default) only reports.
- Reinforcement is the inverse: `reinforce(ids)` increments `strength`, sets
  `last_reinforced = today`, appends a `reinforce` event. This resets `elapsedDays → 0` and
  raises future stability — each recall makes a memory harder to forget (spaced repetition).

`retentionFor(memory, config, now)` is a pure function and must be unit-tested against the
formula above. Expose `decayReport(vault)` returning per-memory `{ id, retention, forgettable,
daysUntilDeprecate }` for the panel's "decaying soon" view.
`daysUntilDeprecate` solves `retention = deprecateThreshold` for elapsedDays, minus current
elapsed: `stability * ln(1/deprecateThreshold) - elapsedDays` (null if pinned).

---

## Consolidation (showcase — implement exactly)

`runConsolidation(vault, { apply })`:

1. Gather **eligible** episodic memories: `tier === 'episodic' && status === 'active' &&
   strength >= minStrength (default 2) && ageDays(created) >= minAgeDays (default 14)`.
2. Tokenize `title + summary + body` → lowercased alnum tokens length ≥ 3, minus a stopword
   set, capped at 80 tokens per memory.
3. Greedy cluster by **Jaccard similarity** ≥ `clusterThreshold` (default **0.18**): for each
   memory, join the first existing cluster whose token set passes the threshold, else start a
   new cluster.
4. Keep clusters with `size >= minClusterSize` (default **3**). Cap at `maxPerRun` (default 3)
   clusters per run.
5. For each kept cluster, synthesize one **semantic** memory:
   - `title`: `"Consolidated: <top 3 shared tokens>"`
   - body: a `## Durable observations` bullet list of each source's summary (or first 180
     body chars), plus a `## Sources` count.
   - `links`: one `{ to: <source id>, rel: informed_by }` per source.
   - frontmatter: `tier: semantic, status: active, confidence: medium, importance: 6,
     strength: 0`.
6. In `--apply`: write the semantic file, set each source's `status: consolidated`, rebuild
   index, append a `consolidate` run-log event. Dry-run reports the planned clusters only.

`semantic → procedural` is **human-invoked only** via `engram promote <id>` (no auto-promotion;
procedural memories are operating rules and deserve a human in the loop).

---

## Search / retrieval

Pure-TS inverted index + **BM25** (`k1=1.5`, `b=0.75`). Persisted to `.engram/index.json` as
`{ version, builtAt, docs: [...], df: {...}, avgdl }`. Tokenizer shared with consolidation.

- `buildIndex(vault)` / `reindex` — full rebuild from `.md` files.
- `search(vault, query, { tier?, type?, status?, limit=10 })` → ranked `SearchHit[]` with
  `{ id, path, title, tier, score, snippet }`. Snippet = best-matching ~30-word window.
- **Hybrid (optional):** if `config.embeddings.provider` is set, `buildVectors` populates
  `.engram/vectors.json`; `search` fuses BM25 and cosine ranks via Reciprocal Rank Fusion
  (`k=60`). With no provider configured, search is lexical-only and fully offline. The
  `EmbeddingProvider` interface: `embed(texts: string[]): Promise<number[][]>`. Ship an
  `OpenAIEmbeddingProvider` stub gated behind an env key; default provider is `null`.

`recall(vault, { query?, context?, limit })` is the agent-facing entry: blends search score
with a recency+strength boost so a recall returns the *most useful* memories, not just the
most lexically similar. Boost: `finalScore = bm25 * (0.6 + 0.4*retention) * (1 + 0.1*strength)`.

---

## HTTP API (served by core, consumed by panel)

`createServer(vault, { staticDir? })` returns a `node:http` server. JSON API, no auth (binds
to `127.0.0.1` only). Routes:

| Method | Route | Returns |
|---|---|---|
| GET | `/api/stats` | `{ total, byTier, byStatus, avgRetention, decayingSoon, recentlyReinforced[] }` |
| GET | `/api/memories?tier=&type=&status=&q=&sort=&limit=` | `MemoryListItem[]` (incl. computed `retention`) |
| GET | `/api/memories/:id` | full `Memory` + `retention` + resolved `links` |
| POST | `/api/memories/:id/reinforce` | updated memory |
| GET | `/api/search?q=&tier=&limit=` | `SearchHit[]` |
| GET | `/api/graph` | `{ nodes: [{id,title,tier,strength,retention}], edges: [{from,to,rel}] }` |
| GET | `/api/decay?` | `decayReport` rows |
| POST | `/api/ops/decay` `{apply}` | run summary |
| POST | `/api/ops/consolidate` `{apply}` | run summary |
| POST | `/api/ops/reindex` | `{ indexed }` |
| GET | `/api/runs?limit=` | recent run-log events |

If `staticDir` is set, any non-`/api` GET serves the built panel (SPA fallback to index.html).
`engram panel` wires `staticDir` to `@engram/panel`'s `dist/`.

---

## CLI surface (`engram`)

```
engram init [dir]                 scaffold a vault (.engram/config.json, tier dirs, sample memory)
engram add                        interactive add (prompts) — or:
engram add -t <title> --tier <t> [--type --importance --tags] [--body -|<text>]
engram search <query> [--tier --type --status --limit --json]
engram recall <query> [--limit --json]      agent-facing blended retrieval
engram reinforce <id...>          bump strength, reset decay clock
engram decay [--apply]            forgetting pass (dry-run default)
engram consolidate [--apply]      consolidation pass (dry-run default)
engram promote <id>               episodic/semantic → procedural (human gate)
engram status                     dashboard: counts by tier, decay health, recent activity
engram reindex                    rebuild the search index
engram doctor                     integrity: broken links, missing/!mismatched frontmatter, orphans
engram panel [--port 4319]        launch the web control panel
```

`status` is the CLI dashboard (cli-table3): a tier breakdown, count of memories decaying soon,
last consolidation run, top 5 most-reinforced. Colors: red for warnings (decaying/forgotten),
grey for chrome, default for values — mirrors the panel palette in the terminal.

Exit non-zero on `doctor` failures so it is CI-usable.

---

## Panel — control panel UI (black / grey / red)

Vite + React SPA. Talks only to the core HTTP API. Four views in a left rail:

1. **Overview** — stat cards (total, per-tier, average retention, # decaying soon); a decay
   curve chart (retention vs. days for a representative memory + the deprecate threshold line);
   a recent-activity feed from `/api/runs`.
2. **Memories** — filterable/sortable table (tier, type, status, strength, retention). Row →
   right drawer: full body, retention gauge, link list, **Reinforce** button.
3. **Graph** — d3-force link graph. Nodes colored by tier, sized by strength, opacity by
   retention. Edges typed by `rel`. Click a node → focus + open its drawer.
4. **Operations** — cards to run Decay / Consolidate / Reindex. Each shows a dry-run preview
   first, then an **Apply** (red) confirm. Renders the run summary + appends to activity.

### Theme tokens (use verbatim — this is the brand)

```
--bg:        #0a0a0b   /* near-black canvas */
--surface:   #141417   /* panels/cards */
--surface-2: #1d1d22   /* raised/hover */
--border:    #2a2a30
--text:      #e7e7ea
--text-dim:  #9a9aa3
--text-mute: #6a6a73
--accent:    #e10600   /* signature red — actions, alerts, decay */
--accent-2:  #ff3b30   /* hover/active red */
--ok:        #3fb950   /* used sparingly for healthy retention */
--warn:      #d29922
--radius:    10px
--font-ui:   "Inter", system-ui, sans-serif
--font-mono: "JetBrains Mono", ui-monospace, monospace
```

Aesthetic: editorial, dense, instrument-panel. Thin borders, generous mono for ids/metrics,
red reserved for actions and decay signals (do not flood with red). No gradients-as-decoration,
no glassmorphism, no emoji in the UI. One signature element: a thin red "retention bar" under
each memory row that depletes as the memory decays. This is the memorable detail — not slop.

---

## Tests (vitest)

- `retentionFor` matches the closed-form formula at sampled (elapsed, strength, importance).
- Reinforce resets the clock and raises stability (retention strictly increases).
- Decay pass deprecates exactly the forgettable set; pinned/high-importance survive.
- Consolidation clusters a hand-built fixture into the expected semantic memory; sources
  flip to `consolidated`.
- BM25 ranks an exact-title match above a body-only match; tier filter excludes other tiers.
- Frontmatter round-trips (parse → serialize → parse) without loss.
- `doctor` flags an injected broken link and a tier/dir mismatch.

CI: Node 20 + 22 matrix — `npm ci`, `npm run build`, `npm test`, `npm run lint`.

---

## Non-goals (v1)

No cloud sync, no multi-user, no auth, no DB server. No telemetry. No network calls unless an
embedding provider is explicitly configured. Keep it a tool a single developer points at a
folder and trusts.
