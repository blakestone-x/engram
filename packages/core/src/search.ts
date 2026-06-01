/**
 * Lexical search: a pure-TypeScript BM25F index persisted to `.engram/index.json`.
 *
 * v0.2 changes:
 * - **BM25F** — title, summary, and body are weighted fields with their own length
 *   normalization, combined before the k1 saturation, using a combined document
 *   frequency for IDF. This replaces v0.1's title-repetition hack, which distorted
 *   document length and term statistics.
 * - **Self-healing incremental index** — `ensureIndex` compares the vault's per-file
 *   mtimes against the index and reconciles only changed/added/removed documents,
 *   so a write no longer triggers a full rebuild.
 * - **Deprecated memories are excluded by default** (set `includeDeprecated` to keep them).
 * - Optional Porter **stemming** so word variants match.
 *
 * The index is derived and rebuildable from the `.md` files alone.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { ENGRAM_DIR } from "./config.js";
import { analyze, tokenize } from "./tokens.js";
import { appendRun } from "./vault.js";
import { storeMemories, storeSignature } from "./store.js";
import type { FieldStats, IndexedDoc, IndexFile, Memory, SearchHit, SearchOptions, Vault } from "./types.js";

const INDEX_VERSION = 2;
const FIELDS = ["title", "summary", "body"] as const;
type Field = (typeof FIELDS)[number];

/** In-process parsed-index cache, keyed by vault root. Avoids re-parsing index.json per query. */
const indexCache = new Map<string, IndexFile>();

function indexPath(vault: Vault): string {
  return join(vault.root, ENGRAM_DIR, "index.json");
}

function fieldText(m: Memory, field: Field): string {
  if (field === "title") return m.frontmatter.title;
  if (field === "summary") return m.frontmatter.summary;
  return m.body;
}

function snippetText(m: Memory): string {
  return `${m.frontmatter.title}\n${m.frontmatter.summary}\n${m.body}`;
}

function emptyFieldStats<T>(value: () => T): FieldStats<T> {
  return { title: value(), summary: value(), body: value() };
}

function buildDoc(m: Memory, mtime: number, stem: boolean): IndexedDoc {
  const tf = emptyFieldStats<Record<string, number>>(() => ({}));
  const fieldLen = emptyFieldStats<number>(() => 0);
  for (const field of FIELDS) {
    const toks = analyze(fieldText(m, field), stem);
    fieldLen[field] = toks.length;
    for (const t of toks) tf[field][t] = (tf[field][t] ?? 0) + 1;
  }
  return {
    id: m.frontmatter.id,
    path: m.path,
    title: m.frontmatter.title,
    tier: m.frontmatter.tier,
    type: m.frontmatter.type,
    status: m.frontmatter.status,
    mtime,
    fieldLen,
    tf,
    text: snippetText(m),
  };
}

function uniqueTerms(doc: IndexedDoc): Set<string> {
  return new Set([...Object.keys(doc.tf.title), ...Object.keys(doc.tf.summary), ...Object.keys(doc.tf.body)]);
}

function addToDf(index: IndexFile, doc: IndexedDoc): void {
  for (const term of uniqueTerms(doc)) index.df[term] = (index.df[term] ?? 0) + 1;
}

function removeFromDf(index: IndexFile, doc: IndexedDoc): void {
  for (const term of uniqueTerms(doc)) {
    const next = (index.df[term] ?? 0) - 1;
    if (next <= 0) delete index.df[term];
    else index.df[term] = next;
  }
}

function recomputeAggregates(index: IndexFile): void {
  const docs = Object.values(index.docs);
  index.count = docs.length;
  for (const field of FIELDS) {
    const total = docs.reduce((sum, d) => sum + d.fieldLen[field], 0);
    index.fieldAvgdl[field] = docs.length ? total / docs.length : 0;
  }
}

function writeIndex(vault: Vault, index: IndexFile): void {
  const path = indexPath(vault);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(index), "utf8");
  renameSync(tmp, path);
  indexCache.set(vault.root, index);
}

/** Build (or rebuild) the entire index from the markdown sources. */
export function buildIndex(vault: Vault, log = false): IndexFile {
  const stem = vault.config.search.stemming;
  const sig = storeSignature(vault.root);
  const index: IndexFile = {
    version: INDEX_VERSION,
    builtAt: new Date().toISOString(),
    count: 0,
    fieldAvgdl: emptyFieldStats<number>(() => 0),
    docs: {},
    df: {},
  };
  for (const m of storeMemories(vault.root)) {
    const doc = buildDoc(m, sig.get(m.frontmatter.id) ?? 0, stem);
    index.docs[doc.id] = doc;
    addToDf(index, doc);
  }
  recomputeAggregates(index);
  writeIndex(vault, index);
  if (log) appendRun(vault, { kind: "reindex", at: index.builtAt, detail: { indexed: index.count } });
  return index;
}

/** Reconcile an existing index against the current vault, touching only changes. */
function reconcile(vault: Vault, index: IndexFile): IndexFile {
  const stem = vault.config.search.stemming;
  const sig = storeSignature(vault.root);
  let changed = false;

  for (const id of Object.keys(index.docs)) {
    if (!sig.has(id)) {
      removeFromDf(index, index.docs[id] as IndexedDoc);
      delete index.docs[id];
      changed = true;
    }
  }
  for (const m of storeMemories(vault.root)) {
    const id = m.frontmatter.id;
    const mtime = sig.get(id) ?? 0;
    const cur = index.docs[id];
    if (cur && cur.mtime === mtime) continue;
    if (cur) removeFromDf(index, cur);
    const doc = buildDoc(m, mtime, stem);
    index.docs[id] = doc;
    addToDf(index, doc);
    changed = true;
  }

  if (changed) {
    recomputeAggregates(index);
    index.builtAt = new Date().toISOString();
    writeIndex(vault, index);
  }
  return index;
}

/** Load the index, rebuilding on version change and reconciling incremental edits. */
export function ensureIndex(vault: Vault): IndexFile {
  const cached = indexCache.get(vault.root);
  if (cached) return reconcile(vault, cached);

  const path = indexPath(vault);
  if (!existsSync(path)) return buildIndex(vault);
  let parsed: IndexFile;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as IndexFile;
  } catch {
    return buildIndex(vault);
  }
  if (parsed.version !== INDEX_VERSION || !parsed.fieldAvgdl) return buildIndex(vault);
  indexCache.set(vault.root, parsed);
  return reconcile(vault, parsed);
}

/** Drop the in-process index cache (tests / external-edit refresh). */
export function invalidateIndex(root?: string): void {
  if (root) indexCache.delete(root);
  else indexCache.clear();
}

function snippetFor(text: string, queryTerms: Set<string>, window = 30): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  let hit = words.findIndex((w) => queryTerms.has(w.toLowerCase().replace(/[^a-z0-9_-]/g, "")));
  if (hit < 0) hit = 0;
  const start = Math.max(0, hit - Math.floor(window / 3));
  const slice = words.slice(start, start + window).join(" ");
  return `${start > 0 ? "… " : ""}${slice}${start + window < words.length ? " …" : ""}`;
}

/** BM25F search with field weighting, filters, and default deprecated exclusion. */
export function search(vault: Vault, query: string, options: SearchOptions = {}): SearchHit[] {
  const index = ensureIndex(vault);
  const stem = vault.config.search.stemming;
  const terms = new Set(analyze(query, stem));
  if (terms.size === 0) return [];
  const rawTerms = new Set(tokenize(query)); // for snippet highlighting (unstemmed)

  const { k1, b, fieldWeights } = vault.config.search;
  const n = index.count;
  const limit = options.limit ?? 10;

  const hits: SearchHit[] = [];
  for (const doc of Object.values(index.docs)) {
    if (options.tier && doc.tier !== options.tier) continue;
    if (options.type && doc.type !== options.type) continue;
    if (options.status) {
      if (doc.status !== options.status) continue;
    } else if (!options.includeDeprecated && doc.status === "deprecated") {
      continue;
    }

    let score = 0;
    for (const term of terms) {
      let combined = 0;
      for (const field of FIELDS) {
        const tf = doc.tf[field][term];
        if (!tf) continue;
        const avg = index.fieldAvgdl[field] || 1;
        const norm = 1 - b + b * (doc.fieldLen[field] / avg);
        combined += (fieldWeights[field] * tf) / (norm || 1);
      }
      if (combined <= 0) continue;
      const df = index.df[term] ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += idf * (combined / (k1 + combined));
    }
    if (score <= 0) continue;
    hits.push({
      id: doc.id,
      path: doc.path,
      title: doc.title,
      tier: doc.tier,
      score,
      snippet: snippetFor(doc.text, rawTerms),
    });
  }

  return hits.sort((a, b2) => b2.score - a.score).slice(0, limit);
}
