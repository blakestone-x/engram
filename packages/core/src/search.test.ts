import { afterEach, describe, expect, it } from "vitest";
import { buildIndex, search } from "./search.js";
import { addMemory } from "./vault.js";
import { cleanupTempDirs, makeTempVault } from "./_testutil.js";

afterEach(cleanupTempDirs);

describe("search / BM25", () => {
  it("ranks an exact title-term match above a body-only match", () => {
    const vault = makeTempVault();
    addMemory(vault, {
      title: "Photosynthesis basics",
      tier: "semantic",
      body: "An overview of how plants convert light.",
    });
    addMemory(vault, {
      title: "Garden notes",
      tier: "episodic",
      body: "Today I read about photosynthesis in the greenhouse.",
    });
    buildIndex(vault);

    const hits = search(vault, "photosynthesis");
    expect(hits.length).toBe(2);
    expect(hits[0].title).toBe("Photosynthesis basics");
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it("a tier filter excludes other tiers", () => {
    const vault = makeTempVault();
    addMemory(vault, { title: "Kubernetes scheduler", tier: "semantic", body: "scheduler internals" });
    addMemory(vault, { title: "Kubernetes outage", tier: "episodic", body: "the scheduler crashed" });
    buildIndex(vault);

    const hits = search(vault, "kubernetes scheduler", { tier: "episodic" });
    expect(hits.length).toBe(1);
    expect(hits[0].tier).toBe("episodic");
  });

  it("empty query returns []", () => {
    const vault = makeTempVault();
    addMemory(vault, { title: "Anything", tier: "working", body: "some body" });
    buildIndex(vault);
    expect(search(vault, "")).toEqual([]);
    // A query of only stopwords/short tokens also tokenizes to nothing.
    expect(search(vault, "the a an")).toEqual([]);
  });
});
