---
id: b9c0d1e2
title: Production deploy procedure
tier: procedural
type: reference
status: active
confidence: high
importance: 9
strength: 8
created: "2026-01-10"
last_reviewed: "2026-05-25"
last_reinforced: "2026-05-25"
tags: [deploy, production, procedure, ops]
links:
  - to: f3a4b5c6
    rel: related
summary: Step-by-step procedure for deploying to production — required reading before any deploy.
---

## Pre-deploy checklist (do not skip)

1. **Migrations reviewed** — Run `npm run db:migrate:dry` on staging and verify output is expected. For any column removal or type change, check for dependent queries first.
2. **Staging green** — All automated tests pass on the staging environment. The PR's CI checks must be green.
3. **Feature flags** — Any new feature with a flag is confirmed OFF in production config before deploy.
4. **On-call aware** — The on-call engineer knows a deploy is happening. Do not deploy without someone watching.
5. **Rollback confirmed** — Identify the previous stable tag and confirm you can `git checkout` and re-deploy in < 5 minutes.

## Deploy steps

```bash
# 1. Tag the release
git tag v<version> -m "Release v<version>"
git push origin v<version>

# 2. CI builds and pushes the Docker image automatically
# Wait for the build to complete (~4 min) before proceeding.

# 3. Pull the new image on prod
ssh prod "docker pull ghcr.io/ourorg/app:v<version>"

# 4. Run migrations
ssh prod "docker run --rm ghcr.io/ourorg/app:v<version> npm run db:migrate"

# 5. Swap the container
ssh prod "docker compose up -d app"

# 6. Health check
curl -f https://app.example.com/api/health || echo "HEALTH CHECK FAILED"
```

## Post-deploy (first 15 minutes)

- Watch Sentry for new error spikes.
- Watch the `/api/health` endpoint response time — should be < 200 ms.
- Check the DB connection pool: `docker exec app npm run db:pool:status`.
- If error rate rises > 1%, initiate rollback immediately (see incident response runbook: `f3a4b5c6`).

## Rollback

```bash
ssh prod "docker compose stop app && docker compose run --rm -e TAG=v<previous> app"
```

Takes ~90 seconds. Confirm health check passes after rollback.
