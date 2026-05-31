---
id: f7a8b9c0
title: Checkout timeout incident 2026-04-12
tier: episodic
type: error
status: active
confidence: high
importance: 6
strength: 2
created: "2026-04-12"
last_reviewed: "2026-05-04"
last_reinforced: "2026-05-04"
tags: [incident, checkout, timeout, payment, gateway]
links:
  - to: b3c4d5e6
    rel: related
  - to: d1e2f3a4
    rel: informed_by
summary: Checkout timeout during flash sale; payment gateway connection pool exhausted, requests failed after 10s timeout.
---

Checkout failed for 20% of users during flash sale. Payment gateway connection pool hit maxConnections limit. Requests waited for a connection and hit the 10s timeout. No circuit breaker on gateway client meant checkout endpoint piled up requests. Raised maxConnections as hotfix. Checkout error rate dropped after pool increase. Pattern: checkout timeout from gateway client connection pool exhaustion.
