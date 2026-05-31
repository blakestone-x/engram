---
id: e5f6a7b8
title: Flaky test investigation — payment webhook suite
tier: working
type: note
status: active
confidence: low
importance: 4
strength: 0
created: "2026-05-30"
last_reviewed: "2026-05-30"
last_reinforced: "2026-05-30"
tags: [testing, flaky, webhook]
links: []
summary: Scratch pad for tracing why the payment webhook test suite intermittently fails in CI.
---

## Symptom

`test/webhooks/payment.test.ts` fails roughly 1-in-5 CI runs with a timeout error. Local runs are always green.

## Hypotheses

1. **Race condition on teardown** — the test creates a mock HTTP server and shuts it down before the last event fires.
2. **Shared port** — port `9876` may be occupied by a parallel test worker. Need to confirm Jest worker count on CI vs local.
3. **Clock drift** — webhook signature validation uses `Date.now()`. If CI clock skews, the HMAC timestamp check rejects.

## Next steps

- Add `--runInBand` temporarily to rule out parallelism (hypothesis 2).
- Patch the mock server teardown to await `close` callback explicitly.
- Check if the Stripe test clock library handles skew for us already.

## Status

Still investigating. Not blocking the release but needs a fix before the next sprint.
