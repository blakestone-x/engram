# Multi-agent and cross-platform memory

Engram is a single shared memory layer that many agents — and many agent
*platforms* — can use at once. The frameworks (LangGraph, CrewAI, AutoGen) each
ship their own memory store, and those stores don't talk to each other: a fact an
AutoGen agent learns is invisible to a LangGraph orchestrator. Engram sits outside
the frameworks, speaks MCP, and stores memory as plain files, so it fills that gap.

## Namespacing — keep agents from contaminating each other

Three optional frontmatter fields turn one vault into a multi-agent store:

```yaml
scope: billing-agent     # the namespace (an agent, project, or user)
author: claude-3         # who wrote it — provenance for audit
visibility: private      # private | shared | global
```

Recall is scoped, with a sensible default: a memory is visible when recalling in
namespace `S` if it is **unscoped** (legacy / shared knowledge), **in `S`**, or
marked **`global`**. So agents see their own memory plus the shared/global tier,
never each other's private notes.

```bash
engram add -t "Customer prefers email" --scope billing-agent --author bot-7 --visibility private -b "..."
engram recall "how to reach the customer" --scope billing-agent
```

Over MCP, every tool takes a `scope` (and `engram_remember` takes `author` /
`visibility`), so each connected agent passes its own namespace.

## The shared blackboard

Set `visibility: global` (or leave a memory unscoped) to put it on the shared
tier every agent reads — the "blackboard" pattern for coordination and findings.
Because each memory is its own file, concurrent agents writing *different*
memories never conflict, and `author` records who contributed what.

## Concurrency — deliberately simple

One memory is one file; writes are atomic (temp-file + rename). Agents almost
always write *different* memories, so file-grained last-writer-wins is correct and
contamination-free. The derived index self-heals from the markdown by mtime, so it
is never the source of truth and never the merge bottleneck.

Engram deliberately does **not** use a CRDT. CRDTs solve real-time co-editing of
*one* document; Engram's agents edit *different* memories, and adopting a CRDT
would trade the plain-markdown, git-diffable format — the whole portability story —
for an opaque binary blob. If you ever need true concurrent co-edit of a single
memory, that belongs in an optional adapter, not the core.

## Cross-platform: your memory is `git clone`-able

This is what the database-locked memory services (Mem0, Letta, Zep) cannot offer:

- **Git is your sync layer.** The vault is markdown; `git pull` / `git push`
  synchronizes memory across machines and agents. Append-only, differently-named
  memory files merge without conflict. Branch per agent and merge.
- **Auditable by construction.** `git log` / `git blame` on a memory is a full,
  human-readable history of who wrote what and when — a forensic trail an opaque
  database doesn't give you. Combined with the `author` field, that is also the
  cheapest defense against memory poisoning: every entry is attributed, and the
  blast radius of a bad memory is contained to its scope.
- **No lock-in.** `engram export` writes a portable JSON-Lines bundle (one memory
  per line, all frontmatter + body); `engram import` reads it back, keyed on `id`
  so it is idempotent. Move memory between vaults, or migrate in from another tool.

```bash
engram export -o memory.jsonl          # portable bundle
engram import memory.jsonl             # idempotent; skips ids already present
# the index is derived — regenerate after a git merge:
engram reindex
```

Keep the derived index out of git (`.engram/index.json` and `.engram/vectors.json`
are gitignored) and rebuild it on the other side — git carries the markdown, Engram
rebuilds the index.

## Summary

| Capability | How |
|---|---|
| Per-agent isolation | `scope` + scoped recall (default-isolate, global fallback) |
| Shared coordination | `visibility: global` blackboard tier |
| Provenance / audit | `author` field + git history |
| Concurrency | one-file-per-memory, atomic writes, self-healing index |
| Sync across machines/agents | git (markdown merges; index rebuilt) |
| Portability / no lock-in | `engram export` / `engram import` (JSON-Lines) |
