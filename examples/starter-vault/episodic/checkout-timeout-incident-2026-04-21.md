---
id: b3c4d5e6
title: Checkout timeout incident 2026-04-21
tier: episodic
type: error
status: active
confidence: high
importance: 6
strength: 3
created: 2026-04-21
last_reviewed: 2026-06-01
last_reinforced: 2026-04-21
tags:
  - incident
  - checkout
  - timeout
  - payment
  - gateway
links:
  - to: f7a8b9c0
    rel: related
  - to: d1e2f3a4
    rel: related
summary: Checkout timeout affected 12% of users; payment gateway latency spiked causing cascading request failures.
---

Checkout endpoint timed out for 12% of users. Payment gateway response time spiked from 1s to 12s. Gateway client had no circuit breaker so checkout requests stacked up. Connection pool exhausted. Error rate hit 14%. Added a timeout on gateway client. Checkout recovered after gateway latency dropped. Impact: 340 failed checkout requests, delayed payment processing.
