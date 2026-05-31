---
id: a1b2c3d4
title: Deploy checklist scratch — v2.4.1
tier: working
type: note
status: active
confidence: medium
importance: 3
strength: 0
created: "2026-05-29"
last_reviewed: "2026-05-29"
last_reinforced: "2026-05-29"
tags: [deploy, checklist]
links:
  - to: b9c0d1e2
    rel: informed_by
summary: Scratch notes for the v2.4.1 release deploy — migrate env vars, run smoke tests.
---

## Steps to do before tagging v2.4.1

- [ ] Bump `APP_VERSION` env on prod
- [ ] Run `npm run db:migrate` on prod DB (adds the new `subscription_paused_at` column)
- [ ] Smoke test checkout flow on staging first — last time we missed a broken redirect
- [ ] Enable feature flag `billing_v2` after migration confirms clean
- [ ] Monitor Sentry for 15 min post-deploy

## Notes

Jess said the migration takes ~30 s on prod-size data. No downtime needed (column is nullable).

Remember to tag the release in GitHub and update the changelog before the Slack announce.
