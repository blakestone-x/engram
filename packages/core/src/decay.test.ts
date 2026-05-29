import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "./config.js";
import {
  daysUntilDeprecate,
  isPinned,
  retentionFor,
  runDecay,
  stabilityFor,
} from "./decay.js";
import { addMemory, listMemories, writeMemory } from "./vault.js";
import { cleanupTempDirs, makeFrontmatter, makeTempVault } from "./_testutil.js";

const decay = DEFAULT_CONFIG.decay;

/** A date `days` after `from` (UTC). */
function plusDays(fromISO: string, days: number): Date {
  const base = new Date(`${fromISO}T00:00:00Z`).getTime();
  return new Date(base + days * 86_400_000);
}

afterEach(cleanupTempDirs);

describe("retentionFor — closed form exp(-t/S)", () => {
  const samples: { elapsedDays: number; strength: number; importance: number }[] = [
    { elapsedDays: 0, strength: 0, importance: 5 },
    { elapsedDays: 7, strength: 0, importance: 5 },
    { elapsedDays: 30, strength: 3, importance: 6 },
    { elapsedDays: 14, strength: 1, importance: 3 },
    { elapsedDays: 90, strength: 5, importance: 7 },
  ];

  for (const { elapsedDays: t, strength, importance } of samples) {
    it(`matches at t=${t} strength=${strength} importance=${importance}`, () => {
      const created = "2026-01-01";
      const fm = makeFrontmatter({ strength, importance, created, last_reinforced: created });
      const now = plusDays(created, t);

      const S =
        decay.baseStability *
        (1 + decay.strengthWeight * strength) *
        Math.max(0.25, 1 + decay.importanceWeight * (importance - 5));
      const expected = Math.exp(-t / S);

      expect(stabilityFor(fm, decay)).toBeCloseTo(S, 10);
      expect(retentionFor(fm, decay, now)).toBeCloseTo(expected, 10);
    });
  }

  it("uses last_reinforced over created for the decay clock", () => {
    const fm = makeFrontmatter({
      created: "2026-01-01",
      last_reinforced: "2026-02-01",
      strength: 0,
      importance: 5,
    });
    const now = plusDays("2026-02-01", 10);
    const S = stabilityFor(fm, decay);
    expect(retentionFor(fm, decay, now)).toBeCloseTo(Math.exp(-10 / S), 10);
  });
});

describe("reinforcement effect", () => {
  it("higher strength yields strictly higher retention at the same elapsed time", () => {
    const created = "2026-01-01";
    const now = plusDays(created, 20);
    const weak = makeFrontmatter({ strength: 0, created, last_reinforced: created });
    const strong = makeFrontmatter({ strength: 4, created, last_reinforced: created });
    expect(retentionFor(strong, decay, now)).toBeGreaterThan(retentionFor(weak, decay, now));
  });

  it("isPinned is true exactly when importance >= pinThreshold", () => {
    expect(isPinned(makeFrontmatter({ importance: decay.pinThreshold }), decay)).toBe(true);
    expect(isPinned(makeFrontmatter({ importance: decay.pinThreshold - 1 }), decay)).toBe(false);
  });

  it("isPinned is true for non-active memories regardless of importance", () => {
    expect(isPinned(makeFrontmatter({ importance: 1, status: "consolidated" }), decay)).toBe(true);
  });
});

describe("daysUntilDeprecate", () => {
  it("is null when pinned", () => {
    const fm = makeFrontmatter({ importance: decay.pinThreshold });
    expect(daysUntilDeprecate(fm, decay)).toBeNull();
  });

  it("at the returned remaining time, retention ≈ deprecateThreshold", () => {
    const created = "2026-01-01";
    const fm = makeFrontmatter({ importance: 5, strength: 0, created, last_reinforced: created });
    const now0 = plusDays(created, 0);
    const remaining = daysUntilDeprecate(fm, decay, now0);
    expect(remaining).not.toBeNull();
    const at = plusDays(created, remaining as number);
    expect(retentionFor(fm, decay, at)).toBeCloseTo(decay.deprecateThreshold, 8);
  });

  it("clamps to 0 when already past the threshold", () => {
    const created = "2026-01-01";
    const fm = makeFrontmatter({ importance: 5, strength: 0, created, last_reinforced: created });
    const farFuture = plusDays(created, 10_000);
    expect(daysUntilDeprecate(fm, decay, farFuture)).toBe(0);
  });
});

describe("runDecay", () => {
  function seed() {
    const vault = makeTempVault();
    const created = "2026-01-01";
    // Old, low-importance, never reinforced → forgettable far in the future.
    const old = addMemory(vault, { title: "Old chatter", tier: "episodic", importance: 2 });
    old.frontmatter.created = created;
    old.frontmatter.last_reinforced = created;
    writeMemory(vault, old);
    // Fresh, high-importance → pinned, survives.
    const fresh = addMemory(vault, { title: "Critical decision", tier: "semantic", importance: 9 });
    fresh.frontmatter.created = created;
    fresh.frontmatter.last_reinforced = created;
    writeMemory(vault, fresh);
    return { vault, oldId: old.frontmatter.id, freshId: fresh.frontmatter.id, created };
  }

  it("dry-run reports forgettable but deprecates 0", () => {
    const { vault, created } = seed();
    const now = plusDays(created, 400);
    const summary = runDecay(vault, {}, now);
    expect(summary.applied).toBe(false);
    expect(summary.forgettable).toBe(1);
    expect(summary.deprecated).toBe(0);
    // Nothing on disk changed.
    for (const m of listMemories(vault)) {
      expect(m.frontmatter.status).toBe("active");
    }
  });

  it("--apply deprecates exactly the forgettable memory; pinned survives", () => {
    const { vault, oldId, freshId, created } = seed();
    const now = plusDays(created, 400);
    const summary = runDecay(vault, { apply: true }, now);
    expect(summary.applied).toBe(true);
    expect(summary.deprecated).toBe(1);

    const byId = new Map(listMemories(vault).map((m) => [m.frontmatter.id, m]));
    expect(byId.get(oldId)?.frontmatter.status).toBe("deprecated");
    expect(byId.get(freshId)?.frontmatter.status).toBe("active");
  });
});
