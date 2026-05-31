---
id: b5c6d7e8
title: Checkout timeout hotfix postmortem April 2026
tier: episodic
type: note
status: active
confidence: high
importance: 6
strength: 2
created: "2026-04-23"
last_reviewed: "2026-05-05"
last_reinforced: "2026-05-05"
tags: [postmortem, checkout, timeout, hotfix, payment, gateway]
links:
  - to: b3c4d5e6
    rel: informed_by
  - to: d1e2f3a4
    rel: informed_by
summary: Post-incident review after repeated checkout timeout events — hotfixes applied but gateway client circuit breaker still missing.
---

Applied hotfixes after two checkout timeout incidents: raised gateway connection pool limit, added per-request timeout on gateway client. Duplicate payment intent bug also fixed. Checkout timeout risk reduced but gateway client still lacks a circuit breaker. Next: implement opossum circuit breaker around gateway client to prevent future checkout timeout cascades. Load test checkout at 10x before promotions.
