# Multi-agent and cross-platform memory

Engram can store memories from cooperating agents in one markdown vault. The optional `scope`, `author`, and `visibility` fields provide provenance and a retrieval filter. They are metadata, not an identity or authorization system.

## Scope and visibility

```yaml
scope: billing-agent
author: bot-7
visibility: private
```

The filter in [scope.ts](../packages/core/src/scope.ts) behaves as follows:

- With no requested scope, memories from every namespace are eligible.
- With scope `S`, unscoped memories, memories in `S`, and memories marked `visibility: global` are eligible.
- `private` and `shared` are stored values but do not create different cross-scope behavior.

Any process with access to the vault can read its markdown or make an unscoped request. Use separate vaults and operating-system permissions for mutually untrusted agents.

| Surface | Scope behavior |
|---|---|
| Core `recall` and `packContext` | Optional scope filter |
| CLI `recall` and `context` | Optional `--scope` |
| MCP `engram_context` and `engram_recall` | Optional `scope` |
| CLI `add` and MCP `engram_remember` | Write scope, author, and visibility metadata |
| CLI `search`, HTTP API, and panel | No scope filter |
| Reinforcement and statistics | Reinforce by ID or report the whole vault; no scope argument |

From the built repository root:

```bash
node packages/cli/dist/index.js add --dir ../agent-memory --title "Customer prefers email" --tier episodic --scope billing-agent --author bot-7 --visibility private --body "Confirmed on the call."
node packages/cli/dist/index.js recall "customer email" --dir ../agent-memory --scope billing-agent
```

Use `visibility: global` when a memory should appear in scoped recall for every namespace. An unscoped memory is also visible to all scopes for backward compatibility.

CLI, library, and MCP writes accept all four tiers. `engram promote <id>` sets the selected memory to procedural without checking the caller's identity or source tier. Human review of procedures belongs in the caller's workflow.

## Files and concurrency

Each memory is a markdown file. Writes use a temporary sibling file followed by rename. This protects an individual file write, but Engram provides neither cross-process locking nor multi-file transactions. Concurrent edits or reinforcement of the same memory can overwrite each other. Coordinate shared writers, consolidation, and decay.

The panel refreshes its in-process store before API requests. A new CLI invocation reads from disk. Long-running clients should not assume a transactionally consistent view of other writers.

The lexical index and optional vectors are derived. Preserve `.engram/config.json` and any operation history you need. The repository ignores these paths:

```text
.engram/index.json
.engram/vectors.json
.engram/runs/
```

The run log is local history, not a synchronized or tamper-proof audit trail. A new vault outside this repository needs its own Git ignore rules; repository ignore rules do not follow an exported vault.

## Git and portability

Git can synchronize markdown and configuration across machines. This is a workflow around Engram, not a built-in sync service. Review and resolve conflicts before rebuilding the index. Different memory files often merge cleanly; edits to the same file still need conflict resolution.

```bash
node packages/cli/dist/index.js export --dir ../agent-memory --out memory.jsonl
node packages/cli/dist/index.js import memory.jsonl --dir ../other-vault
node packages/cli/dist/index.js reindex --dir ../other-vault
```

Initialize the destination vault before importing. Export writes one JSON object per memory containing frontmatter and body; it does not include vault configuration or operation logs. Import preserves IDs and skips IDs already present. Repeating an import is idempotent; it does not merge newer versions of existing memories.

There is no CRDT, background sync process, or same-file merge protocol. Git history records committed changes; the `author` field is caller-supplied provenance.
