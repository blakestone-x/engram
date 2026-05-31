---
id: d5e6f7a8
title: Coding convention — typed error results over thrown exceptions in async paths
tier: semantic
type: fact
status: active
confidence: high
importance: 6
strength: 3
created: "2026-03-05"
last_reviewed: "2026-05-18"
last_reinforced: "2026-05-18"
tags: [typescript, conventions, error-handling, async]
links:
  - to: b7c8d9e0
    rel: related
summary: Service layer functions return a typed Result object instead of throwing; exceptions are reserved for unrecoverable programmer errors only.
---

## The convention

In the service layer (anything under `src/services/`), async functions return a `Result<T, E>` discriminated union instead of throwing:

```ts
type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

Callers handle both branches explicitly. Throwing is reserved for actual bugs (invalid state that should never occur), not for expected failure cases like "user not found" or "payment declined."

## Why

1. **Visibility** — when a function can return an error, the type signature says so. Thrown exceptions are invisible until runtime.
2. **Exhaustiveness** — TypeScript can enforce that callers handle every failure variant.
3. **No accidental catch-all** — a broad `catch (e)` in some middleware eats errors and makes debugging hard. Typed results force handling at the call site.

## What still throws

- Programmer errors (invalid arguments, violated invariants) — these should crash loudly so they get fixed, not swallowed.
- Third-party library errors that we're not prepared to handle — let them propagate to the top-level error handler.

## Where this does not apply

Controllers (HTTP layer) and the CLI can use try/catch. The boundary between service results and HTTP responses is fine for a try/catch translation layer.

## Origin

Adopted after a debugging session where a `user.getById` throw was caught by an unrelated middleware, swallowed silently, and the caller received `undefined` instead of crashing. Took 2 hours to find.
