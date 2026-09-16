# Prior art and design rationale

Engram favors inspectable memory and low operating overhead. This page explains the choices implemented in this repository; it is not a benchmark or a claim of superiority over other memory systems.

## Implementation choices

| Area | Current behavior | Source |
|---|---|---|
| Storage | Markdown memories; separate configuration, indexes, vectors, and operation history | [vault.ts](../packages/core/src/vault.ts) |
| Lexical search | BM25F over title, summary, and body, with optional stemming | [search.ts](../packages/core/src/search.ts) |
| Optional hybrid search | Configured embeddings fused with lexical ranks through RRF; exposed by CLI `search --hybrid` | [embeddings.ts](../packages/core/src/embeddings.ts) |
| Agent recall | Lexical score × retention weight × reinforcement weight | [recall.ts](../packages/core/src/recall.ts) |
| Decay | Exponential retention; deprecation applied explicitly without deleting sources | [decay.ts](../packages/core/src/decay.ts) |
| Consolidation | Jaccard clustering of aged, reinforced episodes and extraction of source observations | [consolidate.ts](../packages/core/src/consolidate.ts) |
| Supersession | Deprecate replaced memories while keeping files; optional expiry checks | [vault.ts](../packages/core/src/vault.ts), [recall.ts](../packages/core/src/recall.ts) |
| Dependencies | Three core runtime dependencies: `gray-matter`, `yaml`, and `zod`; no native core addons | [core package](../packages/core/package.json) |
| Namespaces | Optional recall/context filtering; caller-supplied scope and provenance | [scope.ts](../packages/core/src/scope.ts) |

### Markdown as canonical memory

An ordinary editor can inspect a memory; Git can review its changes; copying files can move it between machines. The tradeoff is explicit coordination of writers and merges. There is no transaction manager or built-in synchronization service.

Search indexes are rebuildable. Configuration and operation history are not caches, and vector rebuilding requires the configured provider.

### Lexical retrieval first

BM25F works without an embedding model or network call. Optional embeddings offer a separate semantic search path. CLI and MCP recall/context currently use the lexical retention blend.

This is an implementation tradeoff. The repository does not establish that its ranking outperforms embeddings, graph retrieval, or other memory engines.

### A memory lifecycle

Retention, reinforcement, supersession, and consolidation control which notes surface. Decay changes status rather than deleting files. Consolidation keeps the episodic sources and links the new semantic note to them.

The consolidation pass is deterministic text processing. It does not verify source claims, resolve contradictions, or establish that a repeated observation is true. Likewise, `--as-of` changes retention and expiry calculations but does not reconstruct historical content and status. [Memory-model details](MEMORY-MODEL.md).

### Small integration surface

The CLI supports scripts, the MCP server offers five focused tools, and the panel uses a local HTTP API. Core needs no database server. The cost is a narrower feature set: no authentication, multi-tenant service, hosted sync, or same-memory concurrency control.

## What the evidence does and does not show

Automated tests check engine behavior; smoke checks exercise built entry points. They do not establish improved answer quality, large-vault capacity, or production throughput. Those require workload-specific evaluation.

Context budgets are character-based estimates and can be exceeded by the first result. Scope filters are not authorization. Optional embedding calls send text to the configured provider. These boundaries are documented in the [README](../README.md) and [multi-agent guide](MULTI-AGENT.md).

## Related work

Useful reference points include:

- [The official MCP memory server](https://github.com/modelcontextprotocol/servers/tree/main/src/memory), for a compact MCP memory interface.
- [LangMem](https://github.com/langchain-ai/langmem), for agent memory tooling and memory-type terminology.
- [Graphiti](https://github.com/getzep/graphiti), for temporal knowledge-graph ideas.
- [Letta](https://github.com/letta-ai/letta), [Mem0](https://github.com/mem0ai/mem0), and [Cognee](https://github.com/topoteretes/cognee), for other approaches to persistent agent memory.

These projects have different goals and evolve independently. Consult their current documentation when comparing them; Engram does not reproduce their benchmarks here.
