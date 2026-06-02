/**
 * Portable export/import — the no-lock-in story.
 *
 * Engram's memory is plain markdown you can `git clone`, diff, and merge, which
 * the database-locked memory services (Mem0, Letta, Zep) structurally cannot
 * offer. Export/import to a flat JSON-Lines bundle makes that explicit: move a
 * memory set between vaults, machines, or agents — or migrate in from another
 * tool — with one portable file. Each line is one memory: its frontmatter fields
 * plus `body`.
 */

import { join } from "node:path";
import { coerceFrontmatter } from "./frontmatter.js";
import { getMemory, listMemories, slugify, writeMemory } from "./vault.js";
import type { Memory, Vault } from "./types.js";

/** Export every memory as JSON-Lines (one self-contained memory per line). */
export function exportJsonl(vault: Vault): string {
  return listMemories(vault)
    .map((m) => JSON.stringify({ ...m.frontmatter, body: m.body }))
    .join("\n");
}

export interface ImportResult {
  imported: number;
  skipped: number;
}

/**
 * Import memories from a JSON-Lines bundle, preserving ids and all frontmatter.
 * A memory whose id already exists is skipped (id is the merge key), so import is
 * idempotent and safe to re-run.
 */
export function importJsonl(vault: Vault, jsonl: string): ImportResult {
  let imported = 0;
  let skipped = 0;
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const body = typeof obj.body === "string" ? obj.body : "";
    const frontmatter = coerceFrontmatter(obj, typeof obj.title === "string" ? obj.title : "imported");
    if (getMemory(vault, frontmatter.id)) {
      skipped += 1;
      continue;
    }
    const rel = `${frontmatter.tier}/${slugify(frontmatter.title)}-${frontmatter.id}.md`;
    const memory: Memory = { frontmatter, body, path: rel, absPath: join(vault.root, rel) };
    writeMemory(vault, memory);
    imported += 1;
  }
  return { imported, skipped };
}
