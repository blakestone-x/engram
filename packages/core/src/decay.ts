/**
 * Ebbinghaus decay — the forgetting curve, applied to agent memory.
 *
 * A memory's retention falls off exponentially with the time since it was last
 * reinforced. Reinforcement (recall) both resets that clock and raises the
 * memory's stability, so each recall makes the memory harder to forget — the
 * spaced-repetition effect. Low-value memories that go untouched fall below a
 * threshold and are auto-deprecated ("forgotten"); important memories are pinned
 * and never decay.
 *
 *   retention(t) = exp(-t / S)
 *   S            = baseStability · (1 + strengthWeight·strength) · importanceFactor
 *
 * This module is pure and deterministic given a clock — every value is derived
 * from frontmatter and config, nothing is stored. See SPEC.md and docs/MEMORY-MODEL.md.
 */

import { elapsedDays } from "./dates.js";
import { listMemories, writeMemory, appendRun } from "./vault.js";
import { today } from "./dates.js";
import type {
  DecayConfig,
  DecayRunSummary,
  Frontmatter,
  Memory,
  RetentionResult,
  Vault,
} from "./types.js";

/** importance 5 is neutral; higher slows decay, lower speeds it. Floored at 0.25. */
export function importanceFactor(importance: number, config: DecayConfig): number {
  return Math.max(0.25, 1 + config.importanceWeight * (importance - 5));
}

/** Stability S in days: how slowly this memory decays. */
export function stabilityFor(fm: Pick<Frontmatter, "strength" | "importance">, config: DecayConfig): number {
  return (
    config.baseStability *
    (1 + config.strengthWeight * fm.strength) *
    importanceFactor(fm.importance, config)
  );
}

/** Days elapsed on the decay clock (since last reinforcement, else creation). */
function clockDays(fm: Frontmatter, now: Date): number {
  return elapsedDays(fm.last_reinforced || fm.created, now);
}

/** Retention ∈ (0, 1]. 1 = perfectly retained, → 0 = forgotten. */
export function retentionFor(fm: Frontmatter, config: DecayConfig, now: Date = new Date()): number {
  const t = clockDays(fm, now);
  const s = stabilityFor(fm, config);
  return Math.exp(-t / s);
}

/** A memory is pinned (decay-exempt) if highly important or not active. */
export function isPinned(fm: Frontmatter, config: DecayConfig): boolean {
  return fm.importance >= config.pinThreshold || fm.status !== "active";
}

/**
 * Days until this memory's retention crosses the deprecate threshold.
 * Null when pinned. Zero or negative current overshoot is reported as 0.
 */
export function daysUntilDeprecate(fm: Frontmatter, config: DecayConfig, now: Date = new Date()): number | null {
  if (isPinned(fm, config)) return null;
  const s = stabilityFor(fm, config);
  const deprecateAt = s * Math.log(1 / config.deprecateThreshold);
  const remaining = deprecateAt - clockDays(fm, now);
  return Math.max(0, remaining);
}

function resultFor(memory: Memory, config: DecayConfig, now: Date): RetentionResult {
  const fm = memory.frontmatter;
  const retention = retentionFor(fm, config, now);
  const pinned = isPinned(fm, config);
  const forgettable = fm.status === "active" && fm.importance < config.pinThreshold && retention < config.deprecateThreshold;
  return {
    id: fm.id,
    path: memory.path,
    title: fm.title,
    tier: fm.tier,
    retention,
    pinned,
    forgettable,
    daysUntilDeprecate: daysUntilDeprecate(fm, config, now),
  };
}

/** Per-memory retention report across the whole vault, sorted lowest first. */
export function decayReport(vault: Vault, now: Date = new Date()): RetentionResult[] {
  return listMemories(vault)
    .map((m) => resultFor(m, vault.config.decay, now))
    .sort((a, b) => a.retention - b.retention);
}

/**
 * Run a decay pass. Dry-run by default (reports only). With `apply`, forgettable
 * memories are set to `deprecated`, rewritten, and logged.
 */
export function runDecay(
  vault: Vault,
  options: { apply?: boolean } = {},
  now: Date = new Date(),
): DecayRunSummary {
  const apply = options.apply ?? false;
  const memories = listMemories(vault);
  const rows: RetentionResult[] = [];
  let forgettable = 0;
  let deprecated = 0;

  for (const memory of memories) {
    const row = resultFor(memory, vault.config.decay, now);
    rows.push(row);
    if (!row.forgettable) continue;
    forgettable += 1;
    if (apply) {
      memory.frontmatter.status = "deprecated";
      memory.frontmatter.last_reviewed = today(now);
      writeMemory(vault, memory);
      deprecated += 1;
    }
  }

  rows.sort((a, b) => a.retention - b.retention);

  if (apply) {
    appendRun(vault, {
      kind: "decay",
      at: now.toISOString(),
      detail: { evaluated: memories.length, deprecated, threshold: vault.config.decay.deprecateThreshold },
    });
  }

  return { evaluated: memories.length, forgettable, deprecated, applied: apply, rows };
}
