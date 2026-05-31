---
id: d1e2f3a4
title: Checkout timeout root cause — gateway client missing circuit breaker
tier: episodic
type: observation
status: active
confidence: high
importance: 7
strength: 3
created: "2026-04-17"
last_reviewed: "2026-05-08"
last_reinforced: "2026-05-08"
tags: [checkout, timeout, gateway, root-cause, payment]
links:
  - to: b3c4d5e6
    rel: related
  - to: f7a8b9c0
    rel: related
  - to: b5c6d7e8
    rel: extends
summary: Both checkout timeout incidents trace to the same root cause — gateway client lacks a circuit breaker so timeouts cascade into checkout failure.
---

Root cause of recurring checkout timeout: gateway client has no circuit breaker. When payment gateway slows, checkout requests block waiting for gateway response. Connection pool exhaustion follows. Checkout endpoint becomes unresponsive. Pattern repeats across both April incidents. Fix: wrap gateway client in circuit breaker to fail checkout fast when gateway error rate is high.
