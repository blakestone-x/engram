/** v0.3 tests: namespaces/scopes, reinforce-on-recall, portable export/import. */

import { afterEach, describe, expect, it } from "vitest";
import { recall } from "./recall.js";
import { exportJsonl, importJsonl } from "./export.js";
import { parseFrontmatter, serializeMemory } from "./frontmatter.js";
import { addMemory, getMemory, listMemories } from "./vault.js";
import { inScope } from "./scope.js";
import { cleanupTempDirs, makeFrontmatter, makeTempVault } from "./_testutil.js";

afterEach(cleanupTempDirs);

describe("scope / namespacing", () => {
  it("inScope: unscoped is visible everywhere; scoped only in its namespace unless global", () => {
    expect(inScope({ scope: undefined, visibility: undefined }, "a")).toBe(true);
    expect(inScope({ scope: "a", visibility: undefined }, "a")).toBe(true);
    expect(inScope({ scope: "b", visibility: undefined }, "a")).toBe(false);
    expect(inScope({ scope: "b", visibility: "global" }, "a")).toBe(true);
    expect(inScope({ scope: "b", visibility: undefined }, undefined)).toBe(true); // no scope requested
  });

  it("recall with a scope returns that namespace plus unscoped/global, not other agents", () => {
    const v = makeTempVault();
    const a = addMemory(v, { title: "Deploy runbook", tier: "procedural", body: "kubernetes deploy steps", scope: "agent-a" });
    const b = addMemory(v, { title: "Deploy notes", tier: "episodic", body: "kubernetes deploy notes", scope: "agent-b" });
    const shared = addMemory(v, { title: "Deploy policy", tier: "semantic", body: "kubernetes deploy policy", visibility: "global", scope: "ops" });
    const unscoped = addMemory(v, { title: "Deploy lexicon", tier: "semantic", body: "kubernetes deploy glossary" });

    const ids = recall(v, "kubernetes deploy", { scope: "agent-a", limit: 10 }).map((h) => h.id);
    expect(ids).toContain(a.frontmatter.id);
    expect(ids).toContain(shared.frontmatter.id); // global crosses scopes
    expect(ids).toContain(unscoped.frontmatter.id); // unscoped visible everywhere
    expect(ids).not.toContain(b.frontmatter.id); // other agent's private memory excluded
  });
});

describe("reinforce-on-recall", () => {
  it("bumps strength of the top results only when opted in", () => {
    const v = makeTempVault();
    const m = addMemory(v, { title: "Pool tuning", tier: "semantic", body: "set the pool to 20", importance: 5 });
    recall(v, "pool tuning", { limit: 5 }); // no reinforce
    expect(getMemory(v, m.frontmatter.id)?.frontmatter.strength).toBe(0);
    recall(v, "pool tuning", { limit: 5, reinforce: true });
    expect(getMemory(v, m.frontmatter.id)?.frontmatter.strength).toBe(1);
  });
});

describe("portable export / import", () => {
  it("round-trips memories with ids and scope preserved, and is idempotent", () => {
    const src = makeTempVault();
    addMemory(src, { title: "Fact one", tier: "semantic", body: "alpha body", scope: "team", author: "agent-x", visibility: "shared" });
    addMemory(src, { title: "Fact two", tier: "episodic", body: "beta body" });
    const bundle = exportJsonl(src);
    expect(bundle.split("\n").filter(Boolean)).toHaveLength(2);

    const dest = makeTempVault();
    const first = importJsonl(dest, bundle);
    expect(first.imported).toBe(2);
    const imported = listMemories(dest);
    expect(imported).toHaveLength(2);
    const scoped = imported.find((m) => m.frontmatter.scope === "team");
    expect(scoped?.frontmatter.author).toBe("agent-x");
    expect(scoped?.frontmatter.visibility).toBe("shared");

    // id is the merge key → re-import skips everything
    const second = importJsonl(dest, bundle);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(2);
    expect(listMemories(dest)).toHaveLength(2);
  });
});

describe("frontmatter round-trip for v0.3 fields", () => {
  it("preserves scope, author, visibility", () => {
    const fm = makeFrontmatter({ scope: "proj-1", author: "claude", visibility: "private", id: "abc123de" });
    const parsed = parseFrontmatter(serializeMemory(fm, "body text"), "fallback").frontmatter;
    expect(parsed.scope).toBe("proj-1");
    expect(parsed.author).toBe("claude");
    expect(parsed.visibility).toBe("private");
    expect(parsed.id).toBe("abc123de");
  });
});
