/**
 * Context packing — the lightweight retrieval primitive for prompt injection.
 *
 * Given a query and a token budget, `packContext` runs a blended recall and
 * greedily fills a compact markdown block with the most useful memories until
 * the budget is reached. The result is meant to be dropped straight into an
 * agent's prompt: bounded, ranked, and readable. This is how an agent gets the
 * benefit of a large memory without paying to stuff all of it into context.
 */

import { recall } from "./recall.js";
import { listMemories } from "./vault.js";
import type { Memory, Tier, Vault } from "./types.js";

export interface ContextEntry {
  id: string;
  title: string;
  tier: Tier;
  retention: number;
}

export interface ContextPack {
  /** The formatted markdown block (empty string when nothing matched). */
  text: string;
  used: ContextEntry[];
  /** Rough token estimate of `text` (~4 chars/token). */
  tokensEstimate: number;
}

export interface PackOptions {
  /** Approximate token budget for the whole block. Default 1500. */
  budget?: number;
  tier?: Tier;
  /** Include a short body excerpt under each entry. Default false (summaries only). */
  includeBody?: boolean;
  /** Override the header line. */
  header?: string;
}

/** Rough token estimate. Good enough for budgeting; not a real tokenizer. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function firstLine(body: string): string {
  return body.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
}

export function packContext(vault: Vault, query: string, options: PackOptions = {}): ContextPack {
  const budget = options.budget ?? 1500;
  const hits = recall(vault, query, { tier: options.tier, limit: 50 });
  if (hits.length === 0) return { text: "", used: [], tokensEstimate: 0 };

  const byId = new Map<string, Memory>(listMemories(vault).map((m) => [m.frontmatter.id, m]));
  const header = options.header ?? `# Recalled memory for: ${query}`;
  const lines = [header, ""];
  const used: ContextEntry[] = [];
  let tokens = estimateTokens(header);

  for (const hit of hits) {
    const memory = byId.get(hit.id);
    const summary = (memory?.frontmatter.summary || firstLine(memory?.body ?? "") || hit.title).slice(0, 200);
    let entry = `- [${hit.tier}] ${hit.title}: ${summary} (id ${hit.id})`;
    if (options.includeBody && memory) {
      const excerpt = memory.body.replace(/\s+/g, " ").trim().slice(0, 240);
      if (excerpt) entry += `\n  ${excerpt}`;
    }
    const cost = estimateTokens(entry);
    if (tokens + cost > budget && used.length > 0) break;
    lines.push(entry);
    used.push({ id: hit.id, title: hit.title, tier: hit.tier, retention: hit.retention });
    tokens += cost;
  }

  return { text: lines.join("\n"), used, tokensEstimate: tokens };
}
