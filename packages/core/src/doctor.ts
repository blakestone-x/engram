/**
 * Integrity checks. `engram doctor` runs these and exits non-zero on any error,
 * so it can guard a CI pipeline. Warnings (e.g. unknown type) do not fail.
 */

import { listMemories } from "./vault.js";
import type { Vault } from "./types.js";
import { TIERS } from "./types.js";

export type IssueLevel = "error" | "warn";

export interface DoctorIssue {
  level: IssueLevel;
  memory: string; // id or path
  message: string;
}

export interface DoctorReport {
  checked: number;
  issues: DoctorIssue[];
  ok: boolean; // no errors
}

export function doctor(vault: Vault): DoctorReport {
  const memories = listMemories(vault);
  const ids = new Set(memories.map((m) => m.frontmatter.id));
  const paths = new Set(memories.map((m) => m.path));
  const seenIds = new Map<string, string>();
  const issues: DoctorIssue[] = [];

  for (const m of memories) {
    const fm = m.frontmatter;
    const ref = fm.id || m.path;

    // Duplicate ids.
    const prior = seenIds.get(fm.id);
    if (prior) issues.push({ level: "error", memory: ref, message: `duplicate id, also on ${prior}` });
    else seenIds.set(fm.id, m.path);

    // Missing essentials.
    if (!fm.title) issues.push({ level: "error", memory: ref, message: "missing title" });
    if (!fm.summary) issues.push({ level: "warn", memory: ref, message: "missing summary" });

    // Tier directory vs frontmatter tier.
    const topDir = m.path.split("/")[0];
    if (topDir && TIERS.includes(topDir as never) && topDir !== fm.tier) {
      issues.push({ level: "warn", memory: ref, message: `lives in ${topDir}/ but tier is ${fm.tier}` });
    }

    // Unknown type.
    if (!vault.config.types.includes(fm.type)) {
      issues.push({ level: "warn", memory: ref, message: `unknown type "${fm.type}"` });
    }

    // Broken links.
    for (const link of fm.links) {
      if (!ids.has(link.to) && !paths.has(link.to)) {
        issues.push({ level: "error", memory: ref, message: `broken link → ${link.to}` });
      }
    }

    // importance bounds.
    if (fm.importance < 1 || fm.importance > 10) {
      issues.push({ level: "error", memory: ref, message: `importance ${fm.importance} out of range 1-10` });
    }
  }

  const ok = !issues.some((i) => i.level === "error");
  return { checked: memories.length, issues, ok };
}
