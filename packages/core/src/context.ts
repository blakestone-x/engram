/**
 * Context packing — the lightweight retrieval primitive for prompt injection.
 *
 * Given a query and a token budget, `packContext` runs a blended recall and fills
 * a compact, structured markdown block with the most useful memories until the
 * budget (or item cap) is reached. Structured beats prose for discrete facts, so
 * each line carries the tier, confidence, retention, id, and validity — enough for
 * the model to weigh and to reference a specific memory by id, and no more. Near
 * duplicates (same title) are suppressed so the block isn't three copies of one
 * fact. The block is data, not instructions: nothing here tells the agent what to do.
 */

import { recall } from "./recall.js";
import { getMemory } from "./vault.js";
import type { ContextPack, ContextEntry, PackOptions, Vault } from "./types.js";

/** Rough token estimate. Good enough for budgeting; not a real tokenizer. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function firstLine(body: string): string {
  return body.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
}

export function packContext(vault: Vault, query: string, options: PackOptions = {}): ContextPack {
  const budget = options.budget ?? 1500;
  const maxItems = options.maxItems ?? 12;
  const hits = recall(vault, query, { tier: options.tier, limit: maxItems * 3 });
  if (hits.length === 0) return { text: "", used: [], tokensEstimate: 0, dropped: 0 };

  const header = options.header ?? `# Recalled memory for: ${query}`;
  const lines = [header, ""];
  const used: ContextEntry[] = [];
  const seenTitles = new Set<string>();
  let tokens = estimateTokens(header);
  let dropped = 0;

  for (const hit of hits) {
    if (used.length >= maxItems) {
      dropped += 1;
      continue;
    }
    const memory = getMemory(vault, hit.id);
    const fm = memory?.frontmatter;
    const titleKey = (fm?.title ?? hit.title).toLowerCase().trim();
    if (seenTitles.has(titleKey)) {
      dropped += 1;
      continue;
    }

    const summary = (fm?.summary || firstLine(memory?.body ?? "") || hit.title).slice(0, 200);
    const meta = `${hit.tier}·${fm?.confidence ?? "?"}·${Math.round(hit.retention * 100)}%`;
    const validity = fm?.valid_until ? `, until ${fm.valid_until}` : "";
    let entry = `- [${meta}] ${hit.title}: ${summary} (id ${hit.id}${validity})`;
    if (options.includeBody && memory) {
      const excerpt = memory.body.replace(/\s+/g, " ").trim().slice(0, 240);
      if (excerpt) entry += `\n  ${excerpt}`;
    }

    const cost = estimateTokens(entry);
    if (tokens + cost > budget && used.length > 0) {
      dropped += 1;
      continue;
    }
    lines.push(entry);
    seenTitles.add(titleKey);
    used.push({ id: hit.id, title: hit.title, tier: hit.tier, retention: hit.retention });
    tokens += cost;
  }

  return { text: used.length ? lines.join("\n") : "", used, tokensEstimate: tokens, dropped };
}
