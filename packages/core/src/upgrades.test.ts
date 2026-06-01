/** Tests for v0.2 upgrades: cached store, tier decay, dedup, supersession, BM25F, stemming, context. */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "./config.js";
import { retentionFor } from "./decay.js";
import { packContext } from "./context.js";
import { recall } from "./recall.js";
import { buildIndex, search } from "./search.js";
import { refreshStore } from "./store.js";
import { addMemory, getMemory, listMemories } from "./vault.js";
import { serializeMemory } from "./frontmatter.js";
import { cleanupTempDirs, makeFrontmatter, makeTempVault } from "./_testutil.js";

afterEach(cleanupTempDirs);

const NOW = new Date("2026-06-01T00:00:00Z");
const D30 = "2026-05-02"; // ~30 days before NOW

describe("tier-aware decay", () => {
  it("procedural retains far better than working at equal age", () => {
    const working = makeFrontmatter({ tier: "working", last_reinforced: D30, importance: 5, strength: 0 });
    const procedural = makeFrontmatter({ tier: "procedural", last_reinforced: D30, importance: 5, strength: 0 });
    const rW = retentionFor(working, DEFAULT_CONFIG.decay, NOW);
    const rP = retentionFor(procedural, DEFAULT_CONFIG.decay, NOW);
    expect(rP).toBeGreaterThan(rW);
    expect(rW).toBeLessThan(0.05); // working (stability 0.4*14=5.6d) is nearly gone at 30d
    expect(rP).toBeGreaterThan(0.7); // procedural (stability 8*14=112d) barely moved
  });
});

describe("dedup on add", () => {
  it("reinforces the existing memory instead of writing a duplicate", () => {
    const v = makeTempVault();
    const a = addMemory(v, { title: "Pool size is 20", tier: "semantic", body: "We set the pool max to 20." });
    const b = addMemory(v, { title: "Pool size is 20", tier: "semantic", body: "We set the pool max to 20." });
    expect(b.frontmatter.id).toBe(a.frontmatter.id);
    expect(listMemories(v)).toHaveLength(1);
    expect(getMemory(v, a.frontmatter.id)?.frontmatter.strength).toBe(1);
  });

  it("allowDuplicate writes a second file", () => {
    const v = makeTempVault();
    addMemory(v, { title: "Same", tier: "working", body: "identical" });
    addMemory(v, { title: "Same", tier: "working", body: "identical", allowDuplicate: true });
    expect(listMemories(v)).toHaveLength(2);
  });
});

describe("supersession", () => {
  it("deprecates the superseded memory and excludes it from recall", () => {
    const v = makeTempVault();
    const old = addMemory(v, { title: "Widget price is 10", tier: "semantic", body: "Widget pricing was set to 10 dollars." });
    const fresh = addMemory(v, {
      title: "Widget price is 12",
      tier: "semantic",
      body: "Widget pricing updated to 12 dollars.",
      links: [{ to: old.frontmatter.id, rel: "supersedes" }],
    });
    const reloadedOld = getMemory(v, old.frontmatter.id);
    expect(reloadedOld?.frontmatter.status).toBe("deprecated");
    expect(reloadedOld?.frontmatter.superseded_by).toBe(fresh.frontmatter.id);

    const ids = recall(v, "widget pricing", {}, NOW).map((h) => h.id);
    expect(ids).toContain(fresh.frontmatter.id);
    expect(ids).not.toContain(old.frontmatter.id);
  });
});

describe("BM25F field weighting + stemming", () => {
  it("a title match outranks a body-only match", () => {
    const v = makeTempVault();
    const titled = addMemory(v, { title: "Kubernetes deployment", tier: "semantic", body: "notes about pods" });
    addMemory(v, { title: "Random note", tier: "semantic", body: "kubernetes kubernetes kubernetes mentioned in body only" });
    const hits = search(v, "kubernetes", { limit: 5 });
    expect(hits[0]?.id).toBe(titled.frontmatter.id);
  });

  it("stemming matches word variants", () => {
    const v = makeTempVault();
    const m = addMemory(v, { title: "Service deployment", tier: "episodic", body: "We were deploying the payment service." });
    const hits = search(v, "deploy", { limit: 5 });
    expect(hits.map((h) => h.id)).toContain(m.frontmatter.id);
  });

  it("excludes deprecated memories by default", () => {
    const v = makeTempVault();
    const m = addMemory(v, { title: "Old approach", tier: "semantic", body: "zebra zebra approach" });
    // deprecate it directly
    const mem = getMemory(v, m.frontmatter.id)!;
    mem.frontmatter.status = "deprecated";
    writeFileSync(mem.absPath, serializeMemory(mem.frontmatter, mem.body));
    refreshStore(v.root);
    expect(search(v, "zebra", {}).map((h) => h.id)).not.toContain(m.frontmatter.id);
    expect(search(v, "zebra", { includeDeprecated: true }).map((h) => h.id)).toContain(m.frontmatter.id);
  });
});

describe("incremental index self-heal", () => {
  it("finds a memory added after the index was built, without an explicit rebuild", () => {
    const v = makeTempVault();
    addMemory(v, { title: "First", tier: "working", body: "alpha content" });
    buildIndex(v);
    const added = addMemory(v, { title: "Second", tier: "working", body: "unicorn content" });
    const hits = search(v, "unicorn", { limit: 5 });
    expect(hits.map((h) => h.id)).toContain(added.frontmatter.id);
  });
});

describe("bi-temporal validity", () => {
  it("excludes expired memories from recall unless asked", () => {
    const v = makeTempVault();
    const m = addMemory(v, { title: "Temporary token", tier: "working", body: "narwhal access token", valid_until: "2026-05-01" });
    expect(recall(v, "narwhal", {}, NOW).map((h) => h.id)).not.toContain(m.frontmatter.id);
    expect(recall(v, "narwhal", { includeExpired: true }, NOW).map((h) => h.id)).toContain(m.frontmatter.id);
  });
});

describe("cached store", () => {
  it("refreshStore picks up an externally written file", () => {
    const v = makeTempVault();
    addMemory(v, { title: "One", tier: "working", body: "first" });
    expect(listMemories(v)).toHaveLength(1);
    const fm = makeFrontmatter({ id: "ext0001", title: "Two", tier: "working" });
    writeFileSync(join(v.root, "working", "ext0001.md"), serializeMemory(fm, "second"));
    expect(listMemories(v)).toHaveLength(1); // still cached
    refreshStore(v.root);
    expect(listMemories(v)).toHaveLength(2);
  });
});

describe("context packing", () => {
  it("produces a structured, capped block and reports dropped items", () => {
    const v = makeTempVault();
    for (let i = 0; i < 8; i += 1) {
      addMemory(v, { title: `Cache note ${i}`, tier: "semantic", body: `caching strategy detail number ${i}`, importance: 6 });
    }
    const pack = packContext(v, "caching strategy", { maxItems: 3, budget: 4000 });
    expect(pack.used.length).toBe(3);
    expect(pack.dropped).toBeGreaterThan(0);
    expect(pack.text).toContain("# Recalled memory for: caching strategy");
    expect(pack.text).toMatch(/\(id [0-9a-f]+/); // each entry carries an id
  });
});
