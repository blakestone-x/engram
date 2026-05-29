/** Shared test helpers: unique temp vaults and frontmatter builders. */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { today } from "./dates.js";
import { initVault } from "./vault.js";
import type { Frontmatter, Vault } from "./types.js";

const created: string[] = [];

/** Make a unique temp directory; registered for afterEach cleanup. */
export function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "engram-test-"));
  created.push(dir);
  return dir;
}

/** Make a unique initialized vault in a temp dir. */
export function makeTempVault(): Vault {
  return initVault(makeTempDir());
}

/** Remove every temp dir created during this test. Call in afterEach. */
export function cleanupTempDirs(): void {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  }
}

/** Build a complete Frontmatter with sensible defaults, overridable per field. */
export function makeFrontmatter(overrides: Partial<Frontmatter> = {}): Frontmatter {
  const day = today();
  return {
    id: "test-id",
    title: "Test memory",
    tier: "episodic",
    type: "note",
    status: "active",
    confidence: "medium",
    importance: 5,
    strength: 0,
    created: day,
    last_reviewed: day,
    last_reinforced: day,
    tags: [],
    links: [],
    summary: "",
    ...overrides,
  };
}
