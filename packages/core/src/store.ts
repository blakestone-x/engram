/**
 * Vault store — an in-process cache of parsed memories.
 *
 * v0.1 re-read and re-parsed every `.md` on every call to `listMemories`, which
 * sat under search, recall, stats, graph, decay, consolidation, doctor, and
 * `getMemory` (an O(N) scan by id). This module loads the vault once per process
 * and serves `Map<id>` / `Map<path>` lookups from memory; our own writes update
 * the cache in place via `putMemory`, so nothing re-reads disk in steady state.
 *
 * Freshness model: the cache is loaded once and trusted for the life of the
 * process. A CLI command is one process, so it always reflects disk at start. A
 * long-running host (the panel server) calls `refreshStore` to pick up external
 * edits — that does a cheap `stat` sweep and re-parses only files whose mtime
 * changed. `invalidateStore` drops the cache entirely (tests).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import type { Memory } from "./types.js";
import { TIERS } from "./types.js";

interface StoreEntry {
  loaded: boolean;
  memories: Memory[];
  byId: Map<string, Memory>;
  byPath: Map<string, Memory>;
  mtimes: Map<string, number>; // absPath -> mtimeMs
}

const cache = new Map<string, StoreEntry>();

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function walkMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

export function readMemoryFile(root: string, absPath: string): Memory {
  const raw = readFileSync(absPath, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw, basename(absPath, ".md"));
  return { frontmatter, body, absPath, path: toPosix(relative(root, absPath)) };
}

function rebuildIndexes(entry: StoreEntry): void {
  entry.byId = new Map();
  entry.byPath = new Map();
  for (const m of entry.memories) {
    entry.byId.set(m.frontmatter.id, m);
    entry.byPath.set(m.path, m);
  }
}

function emptyEntry(): StoreEntry {
  return { loaded: false, memories: [], byId: new Map(), byPath: new Map(), mtimes: new Map() };
}

/**
 * Scan the filesystem and reconcile the cache: reuse memories whose mtime is
 * unchanged, re-parse the rest, drop deleted ones. This is the only place that
 * touches disk for reads.
 */
function scan(root: string, entry: StoreEntry): void {
  const current = new Map<string, number>();
  for (const tier of TIERS) {
    for (const abs of walkMarkdown(join(root, tier))) {
      current.set(abs, statSync(abs).mtimeMs);
    }
  }
  const prevByAbs = new Map(entry.memories.map((m) => [m.absPath, m]));
  const memories: Memory[] = [];
  for (const [abs, mt] of current) {
    const reusable = entry.mtimes.get(abs) === mt ? prevByAbs.get(abs) : undefined;
    memories.push(reusable ?? readMemoryFile(root, abs));
  }
  entry.memories = memories;
  entry.mtimes = current;
  entry.loaded = true;
  rebuildIndexes(entry);
}

function getEntry(root: string): StoreEntry {
  let entry = cache.get(root);
  if (!entry) {
    entry = emptyEntry();
    cache.set(root, entry);
  }
  if (!entry.loaded) scan(root, entry);
  return entry;
}

/** Re-scan disk for external edits (for long-running hosts). */
export function refreshStore(root: string): void {
  const entry = cache.get(root) ?? emptyEntry();
  cache.set(root, entry);
  scan(root, entry);
}

export function storeMemories(root: string): Memory[] {
  return getEntry(root).memories;
}

export function storeGet(root: string, idOrPath: string): Memory | null {
  const entry = getEntry(root);
  return entry.byId.get(idOrPath) ?? entry.byPath.get(toPosix(idOrPath)) ?? null;
}

/** Update the cache after a memory file has been written to disk. */
export function putMemory(root: string, memory: Memory): void {
  const entry = cache.get(root);
  if (!entry || !entry.loaded) return; // next load will pick it up
  const existing = entry.byId.get(memory.frontmatter.id);
  if (existing) {
    const idx = entry.memories.indexOf(existing);
    if (idx >= 0) entry.memories[idx] = memory;
    else entry.memories.push(memory);
  } else {
    entry.memories.push(memory);
  }
  entry.byId.set(memory.frontmatter.id, memory);
  entry.byPath.set(memory.path, memory);
  if (existsSync(memory.absPath)) entry.mtimes.set(memory.absPath, statSync(memory.absPath).mtimeMs);
}

/** Map of memory id → file mtimeMs, for index staleness detection (in-memory). */
export function storeSignature(root: string): Map<string, number> {
  const entry = getEntry(root);
  const sig = new Map<string, number>();
  for (const m of entry.memories) sig.set(m.frontmatter.id, entry.mtimes.get(m.absPath) ?? 0);
  return sig;
}

/** Drop the cache for a vault (or all vaults). Mainly for tests. */
export function invalidateStore(root?: string): void {
  if (root) cache.delete(root);
  else cache.clear();
}
