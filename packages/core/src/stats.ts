/** Aggregate vault statistics for the CLI `status` dashboard and panel overview. */

import { daysUntilDeprecate, retentionFor } from "./decay.js";
import { listMemories } from "./vault.js";
import type { MemoryStatus, Tier, Vault, VaultStats } from "./types.js";
import { TIERS } from "./types.js";

const STATUSES: MemoryStatus[] = ["active", "consolidated", "deprecated", "disputed"];

/** Days-until-deprecate threshold for the "decaying soon" count. */
const SOON_DAYS = 7;

export function vaultStats(vault: Vault, now: Date = new Date()): VaultStats {
  const memories = listMemories(vault);
  const byTier = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<MemoryStatus, number>;

  let retentionSum = 0;
  let decayingSoon = 0;

  for (const m of memories) {
    const fm = m.frontmatter;
    byTier[fm.tier] += 1;
    byStatus[fm.status] += 1;
    const retention = retentionFor(fm, vault.config.decay, now);
    retentionSum += retention;
    const until = daysUntilDeprecate(fm, vault.config.decay, now);
    if (fm.status === "active" && until !== null && until <= SOON_DAYS) decayingSoon += 1;
  }

  const recentlyReinforced = [...memories]
    .filter((m) => m.frontmatter.strength > 0)
    .sort((a, b) => b.frontmatter.last_reinforced.localeCompare(a.frontmatter.last_reinforced))
    .slice(0, 5)
    .map((m) => ({
      id: m.frontmatter.id,
      title: m.frontmatter.title,
      strength: m.frontmatter.strength,
      last_reinforced: m.frontmatter.last_reinforced,
    }));

  return {
    total: memories.length,
    byTier,
    byStatus,
    avgRetention: memories.length ? retentionSum / memories.length : 0,
    decayingSoon,
    recentlyReinforced,
  };
}
