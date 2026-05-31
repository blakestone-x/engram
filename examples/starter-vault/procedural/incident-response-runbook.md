---
id: f3a4b5c6
title: Incident response runbook
tier: procedural
type: reference
status: active
confidence: high
importance: 8
strength: 6
created: "2026-01-15"
last_reviewed: "2026-05-22"
last_reinforced: "2026-05-22"
tags: [incident, ops, runbook, on-call]
links:
  - to: b9c0d1e2
    rel: related
  - to: b3c4d5e6
    rel: related
summary: Runbook for responding to production incidents — severity definitions, escalation path, and postmortem process.
---

## Severity levels

| Level | Definition | Response time |
|-------|-----------|---------------|
| P1 | Complete outage or data loss | Immediate — page everyone |
| P2 | Significant degradation affecting > 10% of users | 15 min |
| P3 | Partial degradation, workaround available | 1 hour |
| P4 | Minor issue, no user impact | Next business day |

## Immediate response (first 5 minutes)

1. **Acknowledge** — Post in `#incidents` Slack channel: "I am investigating [symptom]. ETA on first update: 10 min."
2. **Assess severity** — Use the table above.
3. **Don't fix yet** — Understand first. A bad fix can make a P2 into a P1.
4. **Preserve state** — Before any changes, capture logs: `docker logs app --tail=500 > /tmp/incident-$(date +%s).log`.

## Diagnosis order

1. Check error rate in Sentry — what endpoint? What error type?
2. Check DB connections — is the pool exhausted?
3. Check downstream services — payment gateway, email provider, any third-party API in the hot path?
4. Check recent deploys — was there a deploy in the last 2 hours?

## Escalation

- On-call engineer handles P3/P4 solo.
- P2: notify the engineering lead. They decide whether to escalate further.
- P1: page the engineering lead AND the CTO. Customer comms drafted within 30 minutes.

## Rollback trigger

Initiate rollback (see deploy procedure: `b9c0d1e2`) immediately if:
- Error rate > 1% and rising.
- Any P1 symptom (data corruption, auth failure, payment failure).
- On-call cannot identify root cause within 20 minutes.

Do not wait for confirmation before rolling back a P1. Roll back, then explain.

## Postmortem requirement

Every P1 and P2 requires a written postmortem within 48 hours. File it as an episodic memory tagged `[postmortem]` so the team builds a searchable incident history.

Postmortem template:
- What happened (timeline)
- Root cause (one sentence, testable)
- Impact (users affected, revenue, duration)
- Hotfixes applied
- Permanent fix (issue link)
- Process change (if any)
