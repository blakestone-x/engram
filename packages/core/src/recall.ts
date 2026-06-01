/**
 * Recall — the agent-facing retrieval entry point. Unlike raw search, recall
 * blends lexical relevance with how *durable* and *reinforced* a memory is, so
 * an agent gets the memories most worth acting on, not just the most lexically
 * similar. A well-retained, frequently reinforced fact outranks a fading one
 * that happens to share more words.
 */

import { isExpired, retentionFor } from "./decay.js";
import { search } from "./search.js";
import { getMemory } from "./vault.js";
import type { SearchHit, Vault } from "./types.js";

export interface RecallHit extends SearchHit {
  retention: number;
  strength: number;
  finalScore: number;
}

export interface RecallOptions {
  tier?: SearchHit["tier"];
  limit?: number;
  /** Include deprecated/superseded memories (default false). */
  includeDeprecated?: boolean;
  /** Include memories whose bi-temporal validity has lapsed (default false). */
  includeExpired?: boolean;
  /** Time-travel: evaluate retention and validity as of this date (default now). */
  asOf?: Date;
}

export function recall(vault: Vault, query: string, options: RecallOptions = {}, clock: Date = new Date()): RecallHit[] {
  const now = options.asOf ?? clock;
  const limit = options.limit ?? 10;
  const raw = search(vault, query, { tier: options.tier, limit: limit * 3, includeDeprecated: options.includeDeprecated });

  const blended: RecallHit[] = [];
  for (const hit of raw) {
    const memory = getMemory(vault, hit.id);
    if (!memory) continue;
    const fm = memory.frontmatter;
    if (!options.includeDeprecated && fm.status === "deprecated") continue;
    if (!options.includeExpired && isExpired(fm, now)) continue;
    const retention = retentionFor(fm, vault.config.decay, now);
    const finalScore = hit.score * (0.6 + 0.4 * retention) * (1 + 0.1 * fm.strength);
    blended.push({ ...hit, retention, strength: fm.strength, finalScore });
  }

  return blended.sort((a, b) => b.finalScore - a.finalScore).slice(0, limit);
}
