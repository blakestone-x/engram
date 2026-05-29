/** Build the memory link graph for the panel's force-directed view. */

import { retentionFor } from "./decay.js";
import { listMemories } from "./vault.js";
import type { Graph, GraphEdge, GraphNode, Vault } from "./types.js";

export function buildGraph(vault: Vault, now: Date = new Date()): Graph {
  const memories = listMemories(vault);
  const ids = new Set(memories.map((m) => m.frontmatter.id));
  const pathToId = new Map(memories.map((m) => [m.path, m.frontmatter.id]));

  const nodes: GraphNode[] = memories.map((m) => ({
    id: m.frontmatter.id,
    title: m.frontmatter.title,
    tier: m.frontmatter.tier,
    strength: m.frontmatter.strength,
    retention: retentionFor(m.frontmatter, vault.config.decay, now),
  }));

  const edges: GraphEdge[] = [];
  for (const m of memories) {
    for (const link of m.frontmatter.links) {
      const target = ids.has(link.to) ? link.to : pathToId.get(link.to);
      if (target) edges.push({ from: m.frontmatter.id, to: target, rel: link.rel });
    }
  }

  return { nodes, edges };
}
