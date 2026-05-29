import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { doctor } from "./doctor.js";
import { serializeMemory } from "./frontmatter.js";
import { addMemory, writeMemory } from "./vault.js";
import { cleanupTempDirs, makeFrontmatter, makeTempVault } from "./_testutil.js";

afterEach(cleanupTempDirs);

describe("doctor", () => {
  it("a clean vault yields ok=true with no errors", () => {
    const vault = makeTempVault();
    addMemory(vault, {
      title: "Healthy memory",
      tier: "semantic",
      type: "note",
      summary: "all fields present",
    });
    const report = doctor(vault);
    expect(report.ok).toBe(true);
    expect(report.issues.filter((i) => i.level === "error")).toHaveLength(0);
  });

  it("a broken link yields an error and ok=false", () => {
    const vault = makeTempVault();
    const m = addMemory(vault, { title: "Has a dangling link", tier: "semantic", summary: "s" });
    m.frontmatter.links = [{ to: "does-not-exist", rel: "related" }];
    writeMemory(vault, m);

    const report = doctor(vault);
    expect(report.ok).toBe(false);
    expect(
      report.issues.some((i) => i.level === "error" && /broken link/.test(i.message)),
    ).toBe(true);
  });

  it("a tier-dir / frontmatter mismatch yields a warn (not an error)", () => {
    const vault = makeTempVault();
    // Frontmatter says semantic, but the file lives in episodic/.
    const fm = makeFrontmatter({
      id: "mismatch01",
      title: "Misfiled memory",
      tier: "semantic",
      summary: "present",
    });
    writeFileSync(join(vault.root, "episodic", "misfiled.md"), serializeMemory(fm, "body"), "utf8");

    const report = doctor(vault);
    expect(report.ok).toBe(true); // mismatch is only a warning
    expect(
      report.issues.some((i) => i.level === "warn" && /tier is semantic/.test(i.message)),
    ).toBe(true);
  });
});
