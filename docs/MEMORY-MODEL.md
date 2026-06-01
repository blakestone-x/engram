# The Engram memory model

This document explains the cognitive model Engram implements and derives the math behind decay, reinforcement, and consolidation. Every number here is a default from `.engram/config.json`; change the config and the curves shift accordingly.

## The four tiers

Engram fixes four tiers, ordered from most volatile to most durable. A memory's tier is set in its frontmatter, not by which directory it happens to sit in.

| Tier | What belongs in it | Typical lifespan |
|---|---|---|
| `working` | Scratch state for the current task — intermediate results, a plan you are executing, a value you will discard. | Minutes to a day. |
| `episodic` | Time-stamped observations and events. "On 5/30 the customer said X." The raw record of what happened. | Days to weeks unless reinforced. |
| `semantic` | Durable facts and knowledge distilled from experience. "This customer replies same-day to email." Stable, broadly useful. | Long-lived. |
| `procedural` | Operating rules — the things an agent should always do or never do. "Never dispatch without confirming the address." | Permanent, human-curated. |

The tiers map onto how the engine treats a memory. Working and episodic memories are expected to churn; the decay curve does most of its visible work on them. Semantic memories are the consolidation target. Procedural memories are operating rules and are only ever created by a human via `engram promote` — there is no automatic path into the procedural tier.

`engram doctor` warns when a file lives in one tier directory but declares a different tier in frontmatter, because that is almost always an editing mistake.

## Decay: the forgetting curve

Human memory retention falls off roughly exponentially with time, and the rate of falloff slows each time the memory is recalled. That is the Ebbinghaus forgetting curve and the spaced-repetition effect. Engram applies the same shape to agent memory.

For a memory `m` evaluated at time `now`:

```
t         = days since m.last_reinforced (or m.created if never reinforced)
S         = baseStability · (1 + strengthWeight · strength) · importanceFactor(importance) · tierFactor(tier)
retention = exp(-t / S)
```

`retention` is in `(0, 1]`. It is 1 the moment a memory is created or reinforced and decays toward 0 from there. It is a pure function of frontmatter and config — nothing is stored, so the same memory evaluated on two different days gives two different retentions with no write in between.

### Stability

`S` is the stability, in days. It is the time constant of the exponential: larger `S` means slower decay. Three things set it.

- **`baseStability`** (default **14**) is the stability of a neutral memory — importance 5, strength 0. At `t = baseStability`, retention is `exp(-1) ≈ 0.368`, so a neutral, never-reinforced memory has lost about 63% of its retention after two weeks.
- **`strengthWeight`** (default **0.8**) scales how much each reinforcement extends stability. `strength` is the count of times the memory has been reinforced.
- **importance** feeds `importanceFactor`, below.

### Importance factor

```
importanceFactor(i) = max(0.25, 1 + importanceWeight · (i − 5))
```

with `importanceWeight` default **0.15**. Importance 5 is neutral (factor 1.0). Higher importance lengthens stability; lower importance shortens it. The `max(0.25, …)` floor stops a very low-importance memory from getting a near-zero or negative stability.

### Tier factor

The tiers are a half-life ladder. `tierFactor(tier)` reads `decay.tierStability` (default **working 0.4 · episodic 1 · semantic 2.5 · procedural 8**; a value of 0 or a missing tier means 1). This is what makes the tiers physical rather than organizational:

- A neutral **working** memory has `S = 14 · 0.4 = 5.6` days — it is nearly gone (retention ≈ 0.005) after a month untouched. Scratch should evaporate.
- A neutral **episodic** memory uses base stability (factor 1).
- A neutral **semantic** memory has `S = 35` days, so durable knowledge fades slowly.
- A neutral **procedural** memory has `S = 112` days and, combined with the high importance such rules usually carry, is effectively permanent.

Promoting a memory up a tier (`engram promote`, or consolidation episodic → semantic) therefore lengthens its half-life as well as changing what it means.

Worked factors at the default weight:

| importance | factor |
|---|---|
| 1 | 0.40 |
| 2 | 0.55 |
| 5 | 1.00 |
| 8 | 1.45 |
| 10 | 1.75 |

### Pinning

A memory is **pinned** — reported but exempt from auto-deprecation — when either `importance >= pinThreshold` (default **8**) or `status !== 'active'`. Pinned memories still show a retention number, but the decay pass will never deprecate them. This is how you mark something you never want forgotten: set its importance to 8 or higher.

### The deprecate threshold

`deprecateThreshold` (default **0.15**) is the retention floor. An active, unpinned memory whose retention drops below it is **forgettable**. The decay pass, run with `--apply`, sets forgettable memories to `status: deprecated` and rewrites the file. Dry-run (the default) only reports them.

The day a memory will cross the threshold is closed-form. Solving `exp(−t / S) = deprecateThreshold` for `t`:

```
t_deprecate = S · ln(1 / deprecateThreshold)
```

`daysUntilDeprecate` returns `t_deprecate − t_current` (or `null` if the memory is pinned). With the defaults, `ln(1 / 0.15) ≈ 1.897`, so a neutral memory (`S = 14`) is forgettable after about **26.6 days** of neglect.

## Worked examples

### A low-importance memory fading

Take an importance-2, strength-0 memory — a minor observation you never reinforce.

```
importanceFactor(2) = 1 + 0.15·(2 − 5) = 0.55
S = 14 · (1 + 0.8·0) · 0.55 = 7.70 days
```

Its retention over time:

| age (days) | retention |
|---|---|
| 0 | 1.000 |
| 14 | 0.162 |
| 30 | 0.020 |
| 90 | 0.0000084 |

It crosses the 0.15 deprecate threshold at `7.70 · ln(1/0.15) ≈ 14.6 days`. So a decay pass run any time after about two weeks will mark this memory forgettable, and `--apply` will deprecate it. At 14 days its retention (0.162) is just above the floor; a day or two later it falls below.

### Reinforcement extending stability

Now a neutral importance-5 memory, and watch what reinforcement does to its stability and its time-to-deprecate.

| strength | S (days) | days until deprecate (from fresh) |
|---|---|---|
| 0 | 14.0 | 26.6 |
| 1 | 25.2 | 47.8 |
| 2 | 36.4 | 69.1 |
| 3 | 47.6 | 90.3 |

Each reinforcement adds `strengthWeight · baseStability · importanceFactor = 0.8 · 14 · 1.0 = 11.2` days to stability (for a neutral memory). It also resets `t` to 0, because `last_reinforced` becomes today. So a memory you recall and reinforce three times over a couple of months ends up with roughly three months of runway before it would be at risk — and every fresh recall buys more. This is the spaced-repetition mechanic: the memories you actually use become the ones hardest to forget.

### A pinned memory

An importance-8 memory has `importanceFactor(8) = 1.45` and `S = 20.3` days, so at 30 days its retention is about 0.228. But importance 8 meets `pinThreshold`, so it is pinned: the retention is reported, `daysUntilDeprecate` is `null`, and the decay pass will never deprecate it regardless of how low retention goes. Use importance 8+ for facts you want kept indefinitely without having to reinforce them on a schedule.

## How decay enters retrieval

`recall` (the agent-facing retrieval entry) does not return the most lexically similar memories — it returns the most *useful* ones, blending the BM25 score with retention and reinforcement:

```
finalScore = bm25 · (0.6 + 0.4 · retention) · (1 + 0.1 · strength)
```

A perfectly retained memory gets the full `bm25` weight; a fully decayed one keeps 60% of it. Reinforcement adds 10% per point of strength. The effect is that a durable, frequently-used memory will outrank a fading one even when the fading one shares a few more query words. (Deprecated, superseded, and expired memories are dropped from recall by default.)

## Supersession and validity

Decay handles "this got old." A separate mechanism handles "this got *replaced*." When a fact changes, you write the new memory with a `supersedes` link to the old one; Engram marks the old memory `deprecated` and stamps its `superseded_by` with the new id. Nothing is deleted — the old memory stays on disk, out of normal retrieval but recoverable.

A memory may also carry an optional `valid_until` date. Past that date it is *expired*: still on disk, still part of the record, but excluded from recall the same way a superseded one is.

Both together give a lightweight bi-temporal model: you can ask `recall --as-of <date>` (or pass `asOf` in the library / `as_of` in the MCP tool) to retrieve what was known and still valid at a past point in time, with memories superseded or expired after that date excluded. It is the queryable-history idea from temporal knowledge graphs, expressed as two optional frontmatter fields rather than a graph database.

## Consolidation: episodic to semantic

Decay removes dead weight. Consolidation does the opposite job — it turns accumulated episodic experience into durable semantic knowledge, the way sleep consolidates a day's episodes.

### Eligibility

A memory is eligible for consolidation when all of the following hold:

- `tier === 'episodic'`
- `status === 'active'`
- `strength >= minStrength` (default **2**) — it has been reinforced at least twice, so it has proven useful.
- `age >= minAgeDays` (default **14**) — measured from `created`, so the experience has had time to recur.

The age and strength gates together mean consolidation only fires on episodic memories that have both stuck around and been used. A one-off observation from yesterday is not a candidate.

### Clustering

Eligible memories are clustered by **Jaccard similarity** on their token sets. The token set for a memory is the lowercased alphanumeric tokens (length ≥ 3, minus a stopword list) from its title, summary, and body, capped at 80 tokens. Jaccard similarity between two sets is `|A ∩ B| / |A ∪ B|`.

Clustering is greedy and single-pass: for each memory, join the first existing cluster whose accumulated token set has Jaccard similarity `>= clusterThreshold` (default **0.18**), otherwise start a new cluster. The threshold is deliberately low — 0.18 means roughly one shared token in five — because episodic memories about the same topic phrase things differently, and the cost of a slightly loose cluster is one extra bullet in a summary, not a wrong fact.

Only clusters of at least `minClusterSize` (default **3**) members are kept, and at most `maxPerRun` (default **3**) clusters are consolidated in a single pass, so one run never rewrites the whole vault.

### Synthesis

For each kept cluster, the pass writes one new semantic memory:

- **title**: `Consolidated: <top shared tokens>` (the tokens that appear in at least two members, most frequent first).
- **body**: a `## Durable observations` bullet list — each source's summary, or the first non-empty body line, truncated to 180 characters — followed by a `## Sources` count.
- **links**: one `{ to: <source id>, rel: informed_by }` per source, so the provenance is queryable.
- **frontmatter**: `tier: semantic`, `status: active`, `confidence: medium`, `importance: 6`, `strength: 0`.

Each source is then marked `status: consolidated`. The sources are kept, not deleted — the episodic trail remains, and because a consolidated memory is no longer `active`, it is pinned and stops decaying.

### Why semantic to procedural is human-gated

There is no automatic promotion from semantic to procedural. Procedural memories are operating rules — the things an agent treats as always-true constraints on its behavior. Promoting a statistical summary into a hard rule is exactly the kind of judgment that should not be made by a clustering heuristic. `engram promote <id>` is the only path, and it sets `confidence: high` on the way in, because a rule you commit to should be one you are sure of.
