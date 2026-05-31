---
id: f1a2b3c4
title: API design rule — stable IDs, versioned routes, and no breaking changes without a major
tier: semantic
type: fact
status: active
confidence: high
importance: 7
strength: 4
created: "2026-01-20"
last_reviewed: "2026-05-15"
last_reinforced: "2026-05-15"
tags: [api, design, versioning, contracts]
links:
  - to: f9a0b1c2
    rel: related
summary: Public API contracts are stable forever within a major version; adding fields is safe, removing or renaming is a breaking change requiring a version bump.
---

## The rule

**Adding is non-breaking. Removing or renaming is breaking.**

For our public REST API:

- Adding a new field to a response: safe, ship any time.
- Removing a field, renaming a field, or changing a field's type: **requires a major version bump** and a deprecation window.
- Changing the semantics of an existing field (same name, different meaning): treat as a removal. Breaking.

## Versioning scheme

Routes are versioned in the path: `/api/v1/...`, `/api/v2/...`. We maintain the previous major version for 12 months after a new major is released.

## Why this matters

Our integration partners build against the API. Even a well-intentioned "cleanup" that removes an undocumented field breaks consumers who relied on it. We learned this when we renamed `customer.external_id` to `customer.provider_id` in a patch release and three integrations broke overnight.

## Practical patterns

- Use `id` (stable opaque identifier) everywhere — never use auto-increment integers in public APIs. Auto-increments leak record counts and are hard to shard later.
- Prefer pagination cursors over page numbers — page numbers become invalid when records are inserted or deleted.
- Include a `created_at` and `updated_at` on every public resource so consumers can do incremental syncs.
- Return `null` for missing optional fields rather than omitting the key — consumers should not have to guard against missing keys.

## Related

Token bucket rate limiting decision: `f9a0b1c2`.
