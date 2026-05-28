/**
 * Consolidation — the offline pass that turns experience into knowledge.
 *
 * Aged, reinforced episodic memories that talk about the same things are
 * clustered by token overlap and synthesized into a single durable *semantic*
 * memory, the way sleep consolidates the day's episodes into lasting knowledge.
 * The sources are marked `consolidated` (kept, not deleted — the trail remains).
 *
 * Promotion past semantic (→ procedural, i.e. an operating rule) is deliberately
 * human-gated; see `engram promote`.
 */

import { elapsedDays, today } from "./dates.js";
import { jaccard, tokenSet } from "./tokens.js";
import { addMemory, appendRun, listMemories, updateMemory } from "./vault.js";
import type {
  ConsolidationCluster,
  ConsolidationRunSummary,
  Memory,
  MemoryLink,
  Vault,
} from "./types.js";

interface Candidate {
  memory: Memory;
  tokens: Set<string>;
}

interface Cluster {
  tokens: Set<string>;
  members: Candidate[];
}

function eligible(vault: Vault, now: Date): Candidate[] {
  const c = vault.config.consolidation;
  return listMemories(vault)
    .filter((m) => {
      const fm = m.frontmatter;
      return (
        fm.tier === "episodic" &&
        fm.status === "active" &&
        fm.strength >= c.minStrength &&
        elapsedDays(fm.created, now) >= c.minAgeDays
      );
    })
    .map((memory) => ({
      memory,
      tokens: tokenSet(`${memory.frontmatter.title} ${memory.frontmatter.summary} ${memory.body}`),
    }));
}

/** Greedy single-pass clustering by Jaccard similarity. */
function cluster(candidates: Candidate[], threshold: number): Cluster[] {
  const clusters: Cluster[] = [];
  for (const cand of candidates) {
    let target = clusters.find((cl) => jaccard(cl.tokens, cand.tokens) >= threshold);
    if (!target) {
      target = { tokens: new Set(cand.tokens), members: [] };
      clusters.push(target);
    }
    target.members.push(cand);
    for (const t of cand.tokens) target.tokens.add(t);
  }
  return clusters;
}

function sharedTokens(cl: Cluster): string[] {
  const counts = new Map<string, number>();
  for (const member of cl.members) {
    for (const t of member.tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t)
    .slice(0, 6);
}

function synthesizeBody(cl: Cluster): string {
  const bullets = cl.members.map((m) => {
    const fm = m.memory.frontmatter;
    const line = fm.summary || m.memory.body.split("\n").find((l) => l.trim())?.trim() || fm.title;
    return `- ${line.slice(0, 180)}`;
  });
  return [
    "## Durable observations",
    "",
    ...bullets,
    "",
    "## Sources",
    "",
    `${cl.members.length} episodic memories were consolidated into this entry.`,
    "",
  ].join("\n");
}

/**
 * Run consolidation. Dry-run by default (returns the planned clusters). With
 * `apply`, writes one semantic memory per kept cluster and marks sources
 * `consolidated`.
 */
export function runConsolidation(
  vault: Vault,
  options: { apply?: boolean } = {},
  now: Date = new Date(),
): ConsolidationRunSummary {
  const apply = options.apply ?? false;
  const c = vault.config.consolidation;
  const candidates = eligible(vault, now);
  const kept = cluster(candidates, c.clusterThreshold)
    .filter((cl) => cl.members.length >= c.minClusterSize)
    .slice(0, c.maxPerRun);

  const clusters: ConsolidationCluster[] = [];
  let written = 0;

  for (const cl of kept) {
    const shared = sharedTokens(cl);
    const sourceIds = cl.members.map((m) => m.memory.frontmatter.id);
    const summary: ConsolidationCluster = { sharedTokens: shared, sourceIds };

    if (apply) {
      const links: MemoryLink[] = sourceIds.map((to) => ({ to, rel: "informed_by" }));
      const title = `Consolidated: ${shared.slice(0, 3).join(" ") || today(now)}`;
      const semantic = addMemory(vault, {
        title,
        tier: "semantic",
        type: "observation",
        confidence: "medium",
        importance: 6,
        tags: ["consolidation", ...shared.slice(0, 3)],
        links,
        summary: `Consolidated ${cl.members.length} reinforced episodic memories.`,
        body: synthesizeBody(cl),
      });
      for (const id of sourceIds) {
        updateMemory(vault, id, (m) => {
          m.frontmatter.status = "consolidated";
        });
      }
      summary.writtenPath = semantic.path;
      written += 1;
    }
    clusters.push(summary);
  }

  if (apply && written > 0) {
    appendRun(vault, {
      kind: "consolidate",
      at: now.toISOString(),
      detail: { eligible: candidates.length, written, clusters: clusters.map((c2) => c2.sourceIds.length) },
    });
  }

  return { eligible: candidates.length, clusters, written, applied: apply };
}
