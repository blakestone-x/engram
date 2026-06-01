/** Vault filesystem layer: open/init a vault and read/write memories. */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { ENGRAM_DIR, DEFAULT_CONFIG, loadConfig, saveConfig } from "./config.js";
import { today } from "./dates.js";
import { frontmatterFromInput, serialize } from "./frontmatter.js";
import { scrub } from "./privacy.js";
import { putMemory, storeGet, storeMemories } from "./store.js";
import type { EngramConfig, Memory, MemoryInput, RunEvent, Tier, Vault } from "./types.js";
import { TIERS } from "./types.js";

const RUNS_DIR = "runs";
const RUNS_FILE = "runs.jsonl";

/** Stable content hash of a memory's title + body, for dedup. */
function contentHash(title: string, body: string): string {
  return createHash("sha256").update(`${title.trim()}\n\n${body.trim()}`).digest("hex");
}

/** Write a file atomically: write a sibling temp file, then rename over the target. */
function writeFileAtomic(absPath: string, content: string): void {
  const tmp = `${absPath}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, absPath);
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "memory"
  );
}

/** True if `dir` looks like an Engram vault (has a `.engram/` directory). */
export function isVault(dir: string): boolean {
  return existsSync(join(dir, ENGRAM_DIR));
}

/** Walk up from `start` to find the nearest vault root, or null. */
export function findVaultRoot(start: string = process.cwd()): string | null {
  let dir = resolve(start);
  for (;;) {
    if (isVault(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Open an existing vault. Throws if `root` is not a vault. */
export function openVault(root: string): Vault {
  const abs = resolve(root);
  if (!isVault(abs)) {
    throw new Error(`Not an Engram vault: ${abs} (run \`engram init\` first)`);
  }
  return { root: abs, config: loadConfig(abs) };
}

/** Create a new vault at `root` with config, tier dirs, and a runs log. */
export function initVault(root: string): Vault {
  const abs = resolve(root);
  mkdirSync(join(abs, ENGRAM_DIR, RUNS_DIR), { recursive: true });
  for (const tier of TIERS) mkdirSync(join(abs, tier), { recursive: true });
  const config: EngramConfig = structuredClone(DEFAULT_CONFIG);
  if (!existsSync(join(abs, ENGRAM_DIR, "config.json"))) saveConfig(abs, config);
  return { root: abs, config };
}

/** Load every memory across all tier directories (cached; see store.ts). */
export function listMemories(vault: Vault): Memory[] {
  return storeMemories(vault.root).slice();
}

/** Look up a memory by id (preferred) or vault-relative path. O(1) via the store. */
export function getMemory(vault: Vault, idOrPath: string): Memory | null {
  return storeGet(vault.root, idOrPath);
}

/** Persist a memory to its `path` atomically, then update the cache. */
export function writeMemory(vault: Vault, memory: Memory): void {
  const abs = memory.absPath || join(vault.root, memory.path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileAtomic(abs, serialize(memory));
  putMemory(vault.root, memory);
}

/**
 * Create a new memory, scrubbing secrets and choosing a path.
 *
 * Two safety nets borrowed from how mature memory systems avoid bloat:
 * - **Dedup:** if an active memory already has identical title+body, the existing
 *   one is reinforced and returned instead of writing a duplicate (unless the
 *   caller passes `allowDuplicate`).
 * - **Supersession:** for any `supersedes` link in the input, the target memory is
 *   marked `deprecated` and stamped with `superseded_by`, so a corrected fact
 *   retires the old one without deleting it (non-lossy).
 */
export function addMemory(vault: Vault, input: MemoryInput): Memory {
  const body = scrub(input.body ?? "", vault.config).text;

  if (!input.allowDuplicate) {
    const hash = contentHash(input.title, body);
    const dup = storeMemories(vault.root).find(
      (m) => m.frontmatter.status === "active" && contentHash(m.frontmatter.title, m.body) === hash,
    );
    if (dup) return reinforce(vault, [dup.frontmatter.id], "dedup")[0] ?? dup;
  }

  const frontmatter = frontmatterFromInput(input);
  const fileName = `${today()}-${slugify(frontmatter.title)}-${frontmatter.id}.md`;
  const rel = `${frontmatter.tier}/${fileName}`;
  const memory: Memory = { frontmatter, body, path: rel, absPath: join(vault.root, rel) };
  writeMemory(vault, memory);

  for (const link of frontmatter.links) {
    if (link.rel !== "supersedes") continue;
    updateMemory(vault, link.to, (target) => {
      target.frontmatter.status = "deprecated";
      target.frontmatter.superseded_by = frontmatter.id;
      target.frontmatter.last_reviewed = today();
    });
  }
  return memory;
}

/** Load a memory, apply a mutator, and write it back. Returns the new state. */
export function updateMemory(
  vault: Vault,
  idOrPath: string,
  mutate: (memory: Memory) => void,
): Memory | null {
  const memory = getMemory(vault, idOrPath);
  if (!memory) return null;
  mutate(memory);
  writeMemory(vault, memory);
  return memory;
}

/**
 * Reinforce memories: bump strength, reset the decay clock, log the event.
 * This is the spaced-repetition primitive — each recall makes a memory harder
 * to forget.
 */
export function reinforce(vault: Vault, ids: string[], reason = "manual"): Memory[] {
  const updated: Memory[] = [];
  const stamp = today();
  for (const id of ids) {
    const m = updateMemory(vault, id, (memory) => {
      memory.frontmatter.strength += 1;
      memory.frontmatter.last_reinforced = stamp;
      memory.frontmatter.last_reviewed = stamp;
    });
    if (m) updated.push(m);
  }
  if (updated.length > 0) {
    appendRun(vault, {
      kind: "reinforce",
      at: new Date().toISOString(),
      detail: { ids: updated.map((m) => m.frontmatter.id), reason },
    });
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Run log
// ---------------------------------------------------------------------------

function runsPath(vault: Vault): string {
  return join(vault.root, ENGRAM_DIR, RUNS_DIR, RUNS_FILE);
}

/** Append a run event to the vault's jsonl run log. */
export function appendRun(vault: Vault, event: RunEvent): void {
  const path = runsPath(vault);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
}

/** Read the most recent run events (newest first). */
export function readRuns(vault: Vault, limit = 50): RunEvent[] {
  const path = runsPath(vault);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  const events: RunEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as RunEvent);
    } catch {
      // skip malformed lines
    }
  }
  return events.reverse().slice(0, limit);
}

export { TIERS };
export type { Tier };
