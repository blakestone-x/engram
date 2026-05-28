/**
 * Lexical search over the vault: a pure-TypeScript inverted index with BM25
 * ranking, persisted to `.engram/index.json`. No native dependency, no server —
 * the index is just JSON derived from the `.md` files and is fully rebuildable.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ENGRAM_DIR } from "./config.js";
import { tokenize } from "./tokens.js";
import { appendRun, listMemories } from "./vault.js";
import type { IndexedDoc, IndexFile, Memory, SearchHit, SearchOptions, Vault } from "./types.js";

const INDEX_VERSION = 1;

function indexPath(vault: Vault): string {
  return join(vault.root, ENGRAM_DIR, "index.json");
}

/** Title weight for indexing: a title term counts as TITLE_BOOST occurrences. */
const TITLE_BOOST = 3;

/** Indexed text (title field-boosted) used for tf/df. */
function indexText(m: Memory): string {
  // Repeat the title so an exact-title match outranks an incidental body mention
  // (field boost within the single-bag BM25 model).
  const title = `${m.frontmatter.title}\n`.repeat(TITLE_BOOST);
  return `${title}${m.frontmatter.summary}\n${m.body}`;
}

/** Natural text used only for snippet extraction (no boost repetition). */
function snippetText(m: Memory): string {
  return `${m.frontmatter.title}\n${m.frontmatter.summary}\n${m.body}`;
}

/** Build (or rebuild) the index from the markdown sources. */
export function buildIndex(vault: Vault, log = false): IndexFile {
  const docs: Record<string, IndexedDoc> = {};
  const df: Record<string, number> = {};
  let totalLen = 0;

  for (const m of listMemories(vault)) {
    const tokens = tokenize(indexText(m));
    const tf: Record<string, number> = {};
    for (const t of tokens) tf[t] = (tf[t] ?? 0) + 1;
    for (const term of Object.keys(tf)) df[term] = (df[term] ?? 0) + 1;
    const len = tokens.length;
    totalLen += len;
    docs[m.frontmatter.id] = {
      id: m.frontmatter.id,
      path: m.path,
      title: m.frontmatter.title,
      tier: m.frontmatter.tier,
      type: m.frontmatter.type,
      status: m.frontmatter.status,
      len,
      tf,
      text: snippetText(m),
    };
  }

  const count = Object.keys(docs).length;
  const index: IndexFile = {
    version: INDEX_VERSION,
    builtAt: new Date().toISOString(),
    avgdl: count ? totalLen / count : 0,
    docs,
    df,
  };

  const path = indexPath(vault);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(index), "utf8");
  if (log) appendRun(vault, { kind: "reindex", at: index.builtAt, detail: { indexed: count } });
  return index;
}

/** Load the index, rebuilding if it is missing or a stale version. */
export function ensureIndex(vault: Vault): IndexFile {
  const path = indexPath(vault);
  if (!existsSync(path)) return buildIndex(vault);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as IndexFile;
    if (parsed.version !== INDEX_VERSION) return buildIndex(vault);
    return parsed;
  } catch {
    return buildIndex(vault);
  }
}

function bm25(tf: number, df: number, n: number, len: number, avgdl: number, k1: number, b: number): number {
  const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
  const denom = tf + k1 * (1 - b + (b * len) / (avgdl || 1));
  return idf * ((tf * (k1 + 1)) / (denom || 1));
}

function snippetFor(text: string, queryTerms: Set<string>, window = 30): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  let hit = words.findIndex((w) => queryTerms.has(w.toLowerCase().replace(/[^a-z0-9_-]/g, "")));
  if (hit < 0) hit = 0;
  const start = Math.max(0, hit - Math.floor(window / 3));
  const slice = words.slice(start, start + window).join(" ");
  return `${start > 0 ? "… " : ""}${slice}${start + window < words.length ? " …" : ""}`;
}

/** BM25 search with optional tier/type/status filters. */
export function search(vault: Vault, query: string, options: SearchOptions = {}): SearchHit[] {
  const index = ensureIndex(vault);
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  const termSet = new Set(terms);
  const { k1, b } = vault.config.search;
  const n = Object.keys(index.docs).length;
  const limit = options.limit ?? 10;

  const hits: SearchHit[] = [];
  for (const doc of Object.values(index.docs)) {
    if (options.tier && doc.tier !== options.tier) continue;
    if (options.type && doc.type !== options.type) continue;
    if (options.status && doc.status !== options.status) continue;
    let score = 0;
    for (const term of termSet) {
      const tf = doc.tf[term];
      if (!tf) continue;
      score += bm25(tf, index.df[term] ?? 0, n, doc.len, index.avgdl, k1, b);
    }
    if (score <= 0) continue;
    hits.push({
      id: doc.id,
      path: doc.path,
      title: doc.title,
      tier: doc.tier,
      score,
      snippet: snippetFor(doc.text, termSet),
    });
  }

  return hits.sort((a, b2) => b2.score - a.score).slice(0, limit);
}
