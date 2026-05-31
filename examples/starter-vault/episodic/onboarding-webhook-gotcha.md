---
id: d3e4f5a6
title: Customer onboarding gotcha — webhook fires before DB row commits
tier: episodic
type: error
status: active
confidence: high
importance: 5
strength: 2
created: "2026-04-15"
last_reviewed: "2026-05-01"
last_reinforced: "2026-05-01"
tags: [onboarding, webhook, race-condition, postgres]
links: []
summary: New customer webhooks arrived at the integration partner before the customer row committed in Postgres, causing 404s on partner lookups.
---

## What went wrong

When a new customer completes signup, we fire a `customer.created` webhook synchronously within the signup transaction — before the transaction commits. The integration partner immediately queries our API to fetch the customer record. Because the transaction hasn't committed yet, our API returns a 404.

The partner interprets the 404 as an invalid customer and drops the event. The customer's integration is never provisioned automatically and they have to contact support.

## Root cause

The webhook dispatch call was added inside the `createCustomer` DB transaction without considering that the webhook would trigger an inbound API call during the outbound request. Classic TOCTOU on transaction visibility.

## Fix

Move webhook dispatch to **after** the transaction commits. In practice: return from the transaction, then fire webhooks in the same async context. This ensures the row is readable before any external consumer tries to look it up.

Code pattern:

```ts
const customer = await db.transaction(async (trx) => {
  return await createCustomerRow(trx, input);
});
// Transaction committed — safe to notify externals now
await webhooks.dispatch("customer.created", customer);
```

## Affected releases

v2.1.0 introduced this bug. Fixed in v2.1.3. About 40 customers were affected and needed manual support intervention.

## Generalized rule

Never dispatch outbound calls that trigger inbound queries to the same DB inside an uncommitted transaction.
