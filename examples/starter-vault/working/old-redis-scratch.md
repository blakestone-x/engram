---
id: c9d0e1f2
title: Redis caching experiment notes
tier: working
type: note
status: active
confidence: low
importance: 2
strength: 0
created: "2026-03-22"
last_reviewed: "2026-03-22"
last_reinforced: "2026-03-22"
tags: [redis, caching, experiment]
links: []
summary: Scratch notes from a caching experiment that never shipped — Redis vs in-memory tradeoffs.
---

## Context

Spike from early March. We thought adding Redis for session caching would cut DB load. Ran a bench for a weekend and parked the results.

## Findings (rough)

- Redis added ~2 ms per request overhead on the test instance.
- In-memory LRU was faster for our read patterns but obviously doesn't survive restarts.
- For our scale (~800 RPM), the DB wasn't the bottleneck anyway — it was the N+1 query in the subscription loader.

## Decision at the time

Shelved. Fixed the N+1 instead. Redis might make sense again if we hit 5k RPM or need session sharing across instances.

## Note

This was a throwaway spike. Most of the detail is in the PR description for `fix/subscription-n-plus-one`. This note can probably be deleted.
