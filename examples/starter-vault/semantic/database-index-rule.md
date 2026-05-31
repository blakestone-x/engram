---
id: b7c8d9e0
title: Database index rule — index foreign keys and high-cardinality filter columns
tier: semantic
type: fact
status: active
confidence: high
importance: 8
strength: 5
created: "2026-02-14"
last_reviewed: "2026-05-20"
last_reinforced: "2026-05-20"
tags: [database, postgres, indexes, performance]
links:
  - to: d5e6f7a8
    rel: related
summary: Every foreign key and every column that appears in a WHERE clause with > 1k distinct values must have an index; unindexed FK columns cause sequential scans that silently degrade under load.
---

## The rule

1. **Every foreign key column gets an index.** Postgres does not auto-create indexes on FK columns (unlike primary keys). A missing FK index is invisible at low data volumes and catastrophic at scale — every ON DELETE or JOIN becomes a sequential scan.

2. **Any column used in a high-selectivity WHERE clause gets an index.** Threshold: if a query filters on a column with > ~1,000 distinct values and the query runs > 100 times/day, that column needs an index.

3. **Composite indexes: put the equality column first, the range column second.** For `WHERE status = $1 AND created_at > $2`, the index should be `(status, created_at)`.

## How we learned this

The `subscriptions` table had no index on `user_id` (FK to `users`). At ~50k subscriptions it was fine. At 400k, fetching a user's subscriptions triggered a full sequential scan. The query went from 2 ms to 1.8 s. We only caught it because a customer reported slow dashboard loads.

## Migration practice

Always add indexes `CONCURRENTLY` in production:

```sql
CREATE INDEX CONCURRENTLY idx_subscriptions_user_id ON subscriptions(user_id);
```

This avoids a table lock. Takes longer but is safe for live traffic.

## Monitoring

Run `EXPLAIN ANALYZE` on new queries before shipping. If the plan shows `Seq Scan` on a large table, add the missing index before the feature lands.
