# Engram — starter vault example

A populated example vault so you can see decay and consolidation working on real data.
Theme: engineering and ops memory for a small SaaS team.

## Quick start

```bash
cd examples/starter-vault

# Build the search index
node ../../packages/cli/dist/index.js reindex

# Verify integrity (should exit 0)
node ../../packages/cli/dist/index.js doctor

# Dashboard overview
node ../../packages/cli/dist/index.js status

# See which memories are fading (dry run — no changes)
node ../../packages/cli/dist/index.js decay

# See which episodic clusters are ready to consolidate (dry run)
node ../../packages/cli/dist/index.js consolidate

# Launch the web panel
node ../../packages/cli/dist/index.js panel
```

## What is in the vault

| Tier | Count | What |
|------|-------|------|
| working | 3 | Scratch notes — one is 70+ days old with low importance (decay flags it) |
| episodic | 6 | Four checkout-timeout incidents share overlapping vocabulary (consolidate clusters them); two unrelated entries |
| semantic | 3 | Durable engineering rules — DB indexes, API design, error handling |
| procedural | 2 | Operating procedures — deploy steps, incident runbook |

## Expected output

- `decay`: at least 1 memory flagged as forgettable (the old Redis scratch note).
- `consolidate`: at least 1 cluster found (the four checkout-timeout episodic entries).
- `doctor`: exits 0, no errors.

Neither `decay` nor `consolidate` modifies files without `--apply`.
