# Prior art and design rationale

Engram is one of many agent-memory systems. This document says where it sits, what
it borrowed, what it deliberately did not build, and where the evidence for "memory
helps" is weaker than the marketing. It is written to be argued with.

## The landscape

| System | Storage | Retrieval | Forgetting | Local-first | Dependency weight |
|--------|---------|-----------|------------|-------------|-------------------|
| [Mem0](https://github.com/mem0ai/mem0) | vector (+ optional graph) | hybrid + LLM extract/reconcile | shallow, admitted [open problem](https://mem0.ai/blog/state-of-ai-agent-memory-2026) | self-host or hosted | vector DB + LLM on write |
| [Letta / MemGPT](https://docs.letta.com/concepts/letta/) | Postgres + pgvector | dense | none (paging/eviction) | self-host (Docker) | Postgres + pgvector |
| [Zep / Graphiti](https://github.com/getzep/graphiti) | Neo4j/FalkorDB graph | hybrid + graph traversal | bi-temporal invalidation | self-host or hosted | graph DB + LLM on ingest |
| [Cognee](https://www.cognee.ai/blog/fundamentals/how-cognee-builds-ai-memory) | graph + vector + relational | 14 modes | usage-weighted edge pruning | self-host | multiple engines + LLM |
| [LangMem](https://www.langchain.com/blog/langmem-sdk-launch) | LangGraph store (PG/Mongo) | dense | consolidation/merge | SDK | LangGraph runtime |
| [Official MCP memory server](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) | one `memory.jsonl` | substring/field | none | yes | none |
| **Engram** | **markdown files** | **BM25F + retention blend** (+ optional vectors) | **Ebbinghaus + tier-aware + supersession** | **yes** | **none (pure TS)** |

Two things stand out. First, every system that does serious retrieval drags in a
database — Postgres, Neo4j, a vector store — or an LLM call on every write. The only
zero-dependency peer is the official MCP memory server, and it has no ranking, no
decay, and no consolidation. Second, the field consensus taxonomy is exactly Engram's
tiers: LangMem ships [semantic / episodic / procedural memory](https://langchain-ai.github.io/langmem/guides/extract_episodic_memories/);
Letta's core/recall/archival is the same idea expressed as a paging hierarchy.

## What Engram borrowed

- **Reinforce-on-use** as the spine of decay. Cognee's `memify` reweights edges by
  usage; a research project, [YourMemory](https://github.com/sachitrafa/YourMemory),
  reports +16pp over Mem0 on LoCoMo using Ebbinghaus decay with a recall-count term.
  Engram's `strength` (reinforcement count) raises stability directly.
- **Lightweight bi-temporal supersession.** Zep/Graphiti's strongest idea is marking a
  contradicted fact *invalid* rather than deleting it, so history stays queryable
  ([Graphiti](https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/)).
  Engram implements this as two optional frontmatter fields (`valid_until`,
  `superseded_by`) and a `supersedes` link — the idea at a fraction of the cost, with
  no graph database.
- **BM25F over a field-boost hack.** The correct way to weight a title above the body
  ([Turnbull, "BM25F from scratch"](https://softwaredoug.com/blog/2025/09/18/bm25f-from-scratch))
  is per-field length normalization with a combined document frequency — not repeating
  the title text into the body, which corrupts `avgdl` and IDF. v0.2 does it properly.
- **Structured, capped context.** Google-cited work finds [structured context beats prose](https://github.com/cv-gh/context-engineering)
  by ~19% for discrete facts; cramming more evidence in [lowers](https://arxiv.org/html/2511.10523v1)
  accuracy. `engram context` returns a small, recency-ordered, id-tagged block.

## What Engram deliberately did not build

- **A vector/graph database.** Brute-force cosine is exact and fast under ~100k vectors;
  ANN (HNSW/IVF) is negative ROI at personal-memory scale and adds an index to keep in
  sync. Embeddings stay optional and off by default.
- **LLM extraction on every write.** It is the costliest part of Mem0/Letta/Zep. Engram
  writes what the agent (or user) hands it, de-duplicates by content hash, and does the
  heavier work (consolidation) as an offline batch pass.
- **A cross-encoder reranker / FSRS scheduler.** A reranker needs a model (breaks
  zero-dependency); FSRS/SM-2 schedule *flashcard reviews*, which is a different problem
  from "is this memory still useful." Engram borrows the forgetting-curve shape, not the
  scheduler.

## The skeptic's footnotes

The benchmarks that "prove" memory works deserve suspicion, and Engram's docs try not to
overclaim:

- An [independent audit of LoCoMo](https://dev.to/penfieldlabs/we-audited-locomo-64-of-the-answer-key-is-wrong-and-the-judge-accepts-up-to-63-of-intentionally-33lg)
  found ~6.4% of answer keys wrong and the LLM judge accepting up to 63% of intentionally
  wrong answers — several "SOTA" claims sit inside the noise floor.
- On LoCoMo, a plain full-context baseline often [outscores](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/)
  the memory system. [ConvoMem](https://arxiv.org/html/2511.10523v1) finds retrieval-based
  memory *loses* to long context below ~150 conversations and can drop from 61% to 25%
  accuracy as evidence items pile up.

So the honest pitch is not "memory makes your agent smarter." It is: when an agent's
history outgrows the context window, Engram gives it a *readable, auditable* long-term
store that fades what goes unused, retires facts that get superseded, and returns a small
high-signal block instead of dumping everything in. The wins are in the temporal /
knowledge-update / cost regimes; below a few dozen interactions, just use more context.

## Threats Engram is built to resist

[Memory poisoning](https://arxiv.org/html/2601.05504v2) (planted instructions that
persist and fire later) is the sharpest risk. Engram's structural defense is the same as
its design: memories are **inert markdown facts, rendered as data, never as instructions**.
The MCP `engram_remember` tool says so explicitly, the privacy scrub strips obvious
secrets on write, decay removes unreinforced trivia, and supersession retires stale facts
instead of letting them accumulate. None of this is a guarantee; it is defense in depth.
