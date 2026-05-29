import { afterEach, describe, expect, it } from "vitest";
import { runConsolidation } from "./consolidate.js";
import { addMemory, listMemories, writeMemory } from "./vault.js";
import { cleanupTempDirs, makeTempVault } from "./_testutil.js";
import type { Vault } from "./types.js";

afterEach(cleanupTempDirs);

const CREATED = "2026-01-01";

/** Seed N episodic memories sharing tokens, aged + reinforced enough to be eligible. */
function seedCluster(vault: Vault, n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const m = addMemory(vault, {
      title: `Routing failover incident ${i}`,
      tier: "episodic",
      type: "observation",
      summary: "routing failover timeout incident on the dispatch gateway",
      body: "The routing gateway failover triggered a timeout during dispatch incident handling.",
    });
    // Make it old + reinforced (strength >= minStrength).
    m.frontmatter.created = CREATED;
    m.frontmatter.last_reinforced = CREATED;
    m.frontmatter.strength = 3;
    writeMemory(vault, m);
    ids.push(m.frontmatter.id);
  }
  return ids;
}

/** A date `days` after CREATED. */
function nowAfter(days: number): Date {
  return new Date(new Date(`${CREATED}T00:00:00Z`).getTime() + days * 86_400_000);
}

describe("runConsolidation", () => {
  it("dry-run returns >=1 cluster and writes nothing", () => {
    const vault = makeTempVault();
    seedCluster(vault, 3);
    const now = nowAfter(60); // past minAgeDays (14)
    const summary = runConsolidation(vault, {}, now);
    expect(summary.applied).toBe(false);
    expect(summary.written).toBe(0);
    expect(summary.clusters.length).toBeGreaterThanOrEqual(1);
    expect(summary.clusters[0].sourceIds.length).toBeGreaterThanOrEqual(3);
  });

  it("--apply writes a semantic memory and flips sources to consolidated", () => {
    const vault = makeTempVault();
    const ids = seedCluster(vault, 3);
    const now = nowAfter(60);
    const summary = runConsolidation(vault, { apply: true }, now);

    expect(summary.applied).toBe(true);
    expect(summary.written).toBe(1);
    expect(summary.clusters[0].writtenPath).toMatch(/^semantic\//);

    const all = listMemories(vault);
    const semantic = all.filter((m) => m.frontmatter.tier === "semantic");
    expect(semantic).toHaveLength(1);
    // The written semantic links back to all sources.
    expect(semantic[0].frontmatter.links.map((l) => l.to).sort()).toEqual([...ids].sort());

    const byId = new Map(all.map((m) => [m.frontmatter.id, m]));
    for (const id of ids) {
      expect(byId.get(id)?.frontmatter.status).toBe("consolidated");
    }
  });

  it("ignores memories younger than minAgeDays", () => {
    const vault = makeTempVault();
    seedCluster(vault, 3);
    const tooSoon = nowAfter(5); // < minAgeDays (14)
    const summary = runConsolidation(vault, {}, tooSoon);
    expect(summary.eligible).toBe(0);
    expect(summary.clusters).toHaveLength(0);
  });
});
