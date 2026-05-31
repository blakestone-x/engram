# How Engram came to be

Engram is the public extraction of a memory system I have been running privately for a while, behind a working operations and engineering stack. The agents in that stack accumulate knowledge across sessions — what happened, what the rules are, what turned out to matter — and the system that holds that knowledge grew its own opinions over time. This repository is the engine from that system, generalized and stripped of everything proprietary.

What got carried over is the part that is not specific to any domain: the tiered model, the forgetting curve, reinforcement, consolidation, and the decision to store everything as markdown. What got left behind is all the content and all the domain logic — the actual memories, the schemas tied to a particular business, the integrations, the rules that only make sense inside one operation. None of that is here, and none of it should be. The public version is the mechanism, not the contents.

## Why markdown, not a database

The private system started, like most of these do, with the memories in a store you query through a client. That works until you want to know what the agent actually remembers, and you find yourself writing queries to read your own notes. The friction of inspection turned out to matter more than the speed of retrieval.

So the source of truth became plain `.md` files with YAML frontmatter. The properties that bought:

- **Readable.** You open a memory in any editor and it is a note, not a row. The frontmatter is the metadata; the body is the content.
- **Diffable.** Memories live in git. You can see exactly what changed when a consolidation pass rewrote the store, or what a hand-edit touched.
- **Greppable.** Finding every memory that mentions a thing is `grep`, not a query language.
- **Portable.** The whole memory is a folder. Copy it, sync it however you already sync files, hand it to another tool. There is no server to stand up to read it.

The cost is that you need an index for fast search, and you need to keep it in sync with the files. Engram resolves that by treating the index as derived: the BM25 index in `.engram/index.json` is rebuildable from the markdown with `engram reindex`, and deleting `.engram/` loses speed, not data. The markdown is canonical; everything else is a cache.

## Why a forgetting curve, not unbounded storage

The other early lesson was that a memory store that never forgets gets worse, not better, as it fills. Every observation an agent ever made stays at full weight, so a fact from months ago competes for retrieval against one from this morning, and the signal-to-noise ratio of recall drops as the store grows. The agent's memory becomes a hoard.

Forgetting is the fix, but it has to be principled, not a fixed time-to-live. The Ebbinghaus forgetting curve gives a memory a half-life that depends on how important it is and how often it has been recalled. A memory you keep using resets its own clock and decays more slowly each time — spaced repetition. A memory nothing references falls below a threshold and gets deprecated. The store stays roughly the size of what is actually in use, and retrieval quality holds up because the dead weight has been marked as such.

The deprecate-don't-delete choice matters here. A forgotten memory is marked `deprecated`, not removed, so the trail is intact and a mistake is recoverable. Forgetting in Engram means "stop surfacing this," not "destroy it."

## Why tiers

A flat store treats a scratch note and an operating rule identically, which is wrong in both directions: the scratch note lingers too long and the rule is too easy to lose. Tiers separate by durability. Working memory is meant to churn. Episodic memory is the raw record, expected to decay unless something about it recurs. Semantic memory is the distilled, stable knowledge. Procedural memory is the rules, which a human commits to deliberately.

The tiers are also what makes consolidation meaningful. Without a distinction between "the day's episodes" and "durable knowledge," there is nothing for consolidation to promote *into*. With it, the offline pass has a clear job: take the episodic memories that have aged and been reinforced, find the ones that are about the same thing, and write a semantic memory that captures the pattern — with links back to the episodes it came from.

## What was cut for v1

The public engine is deliberately smaller than the private system it came from. Cut for the first release:

- **Multi-user and sync.** Engram is single-user and local. The private system has more machinery around shared and synchronized memory; none of it is here, and the v1 contract is one developer pointing the tool at one folder.
- **Automatic promotion to procedural.** The clustering heuristic stops at semantic. Turning a summary into an operating rule is a human decision, made through `engram promote`.
- **Domain types and schemas.** The private system bakes in types and structure tied to its work. The public config ships a generic list of types and lets you define your own; no domain enums are hardcoded.
- **A hosted anything.** No service, no telemetry, no network calls unless you wire an embedding provider yourself. The default path touches the network zero times.

What is left is the part worth sharing: a small, dependency-light engine that gives an agent's memory a shape and a metabolism, stored as files you can read. The rest was specific to one operation and stays there.
