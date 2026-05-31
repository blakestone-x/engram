---
id: f9a0b1c2
title: Rate limiter library decision — chose token bucket over leaky bucket
tier: episodic
type: decision
status: active
confidence: high
importance: 5
strength: 2
created: "2026-04-18"
last_reviewed: "2026-05-02"
last_reinforced: "2026-05-02"
tags: [rate-limiting, architecture, api, decision]
links:
  - to: f1a2b3c4
    rel: extends
summary: Chose token bucket rate limiting (via rate-limiter-flexible) over leaky bucket due to burst tolerance requirements.
---

## Decision

Use **token bucket** semantics (via `rate-limiter-flexible` backed by Redis) for the public API rate limiter. Rejected leaky bucket.

## Why token bucket

Our API consumers include dashboard integrations that poll infrequently but then send several requests in quick succession (e.g., syncing a batch of records). Leaky bucket enforces a strict output rate, which would reject legitimate burst traffic even when the user is well within their daily quota.

Token bucket allows a burst up to the bucket capacity, then refills at the configured rate. This matches our actual usage pattern.

## Configuration chosen

- Capacity: 100 tokens (max burst)
- Refill rate: 10 tokens/second
- Scoped per API key (not per IP — we trust authenticated consumers more than raw IPs)

## Redis requirement

This requires Redis to be available. If Redis goes down, the limiter fails open (requests pass through). Acceptable for now — the API is authenticated so abuse risk is low.

## Alternatives considered

- **In-memory (no Redis)**: Rejected because we run multiple app instances. In-memory state is not shared.
- **nginx rate limit**: Rejected because we need per-API-key scoping, not per-IP.
- **Leaky bucket**: Rejected — too punishing for burst traffic patterns.
