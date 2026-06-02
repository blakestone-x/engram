/**
 * Optional semantic layer. Engram is fully functional offline with BM25 alone;
 * wiring an embedding provider adds a vector index and lets `semanticSearch`
 * fuse lexical and semantic ranks via Reciprocal Rank Fusion. Nothing here runs
 * unless `config.embeddings.provider` is set, so the default path makes zero
 * network calls.
 *
 * v0.3:
 * - `semanticSearch` now surfaces semantic-only matches (memories that vector-
 *   match but are not in the lexical top-N) — the whole point of hybrid search.
 *   Ranking uses the fused RRF score.
 * - `buildVectors` is incremental (content-hash gated — only changed memories are
 *   re-embedded), batched (chunked requests), and stamps model + dimension.
 * - The parsed vector file is cached in-process (no JSON re-parse per query).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { ENGRAM_DIR } from "./config.js";
import { search } from "./search.js";
import { getMemory, listMemories } from "./vault.js";
import type { EmbeddingProvider, EngramConfig, Memory, SearchHit, Vault } from "./types.js";

const EMBED_BATCH = 96;

interface VectorFile {
  model: string;
  dim: number;
  builtAt: string;
  vectors: Record<string, number[]>; // memory id -> embedding
  hashes: Record<string, string>; // memory id -> content hash (for incremental rebuild)
}

const vectorCache = new Map<string, VectorFile>();

function vectorsPath(vault: Vault): string {
  return join(vault.root, ENGRAM_DIR, "vectors.json");
}

function embedText(m: Memory): string {
  return `${m.frontmatter.title}\n${m.frontmatter.summary}\n${m.body}`.slice(0, 8000);
}

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Resolve a provider from config, or null for offline/lexical-only. */
export function getProvider(config: EngramConfig): EmbeddingProvider | null {
  if (config.embeddings.provider === "openai") {
    return new OpenAIEmbeddingProvider(config.embeddings.model ?? "text-embedding-3-small");
  }
  return null;
}

/** Minimal OpenAI embeddings client over fetch. Requires OPENAI_API_KEY. */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly model: string) {}

  async embed(texts: string[]): Promise<number[][]> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not set");
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`embeddings request failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => d.embedding);
  }
}

export interface BuildVectorsResult {
  embedded: number;
  reused: number;
  total: number;
}

/**
 * Build/refresh the vector index. Incremental: only memories whose content
 * changed (or all, with `rebuild`) are re-embedded; unchanged vectors are reused.
 * Batched into chunks so a large vault does not exceed provider request limits.
 * No-op (returns zeros) without a provider.
 */
export async function buildVectors(vault: Vault, options: { rebuild?: boolean } = {}): Promise<BuildVectorsResult> {
  const provider = getProvider(vault.config);
  if (!provider) return { embedded: 0, reused: 0, total: 0 };

  const memories = listMemories(vault);
  const model = vault.config.embeddings.model ?? "text-embedding-3-small";
  const existing = options.rebuild ? null : loadVectors(vault);
  const reuseOk = existing != null && existing.model === model;

  const vectors: Record<string, number[]> = {};
  const hashes: Record<string, string> = {};
  const toEmbed: { id: string; text: string; hash: string }[] = [];

  for (const m of memories) {
    const id = m.frontmatter.id;
    const text = embedText(m);
    const hash = contentHash(text);
    if (reuseOk && existing!.hashes[id] === hash && existing!.vectors[id]) {
      vectors[id] = existing!.vectors[id]!;
      hashes[id] = hash;
    } else {
      toEmbed.push({ id, text, hash });
    }
  }

  for (let i = 0; i < toEmbed.length; i += EMBED_BATCH) {
    const chunk = toEmbed.slice(i, i + EMBED_BATCH);
    const embs = await provider.embed(chunk.map((c) => c.text));
    chunk.forEach((c, j) => {
      vectors[c.id] = embs[j] ?? [];
      hashes[c.id] = c.hash;
    });
  }

  const dim = Object.values(vectors).find((v) => v.length > 0)?.length ?? existing?.dim ?? 0;
  const file: VectorFile = { model, dim, builtAt: new Date().toISOString(), vectors, hashes };
  writeVectors(vault, file);
  return { embedded: toEmbed.length, reused: memories.length - toEmbed.length, total: memories.length };
}

function writeVectors(vault: Vault, file: VectorFile): void {
  const path = vectorsPath(vault);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(file), "utf8");
  renameSync(tmp, path);
  vectorCache.set(vault.root, file);
}

function loadVectors(vault: Vault): VectorFile | null {
  const cached = vectorCache.get(vault.root);
  if (cached) return cached;
  const path = vectorsPath(vault);
  if (!existsSync(path)) return null;
  try {
    const file = JSON.parse(readFileSync(path, "utf8")) as VectorFile;
    vectorCache.set(vault.root, file);
    return file;
  } catch {
    return null;
  }
}

/** Drop the in-process vector cache (tests / after an external rebuild). */
export function invalidateVectors(root?: string): void {
  if (root) vectorCache.delete(root);
  else vectorCache.clear();
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Reciprocal Rank Fusion of two ranked id lists → id order (back-compat). */
export function fuse(lexical: string[], semantic: string[], k = 60): string[] {
  return fuseScored(lexical, semantic, k).map(([id]) => id);
}

/** RRF returning [id, score] pairs sorted best-first. */
function fuseScored(lexical: string[], semantic: string[], k = 60): [string, number][] {
  const score = new Map<string, number>();
  const add = (ids: string[]) => {
    ids.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + 1 / (k + rank + 1)));
  };
  add(lexical);
  add(semantic);
  return [...score.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * Hybrid retrieval: BM25 fused with vector cosine when a vector index exists.
 * Surfaces semantic-only matches (built from the store) and ranks by the fused
 * RRF score. Falls back to pure lexical when there is no provider, no vectors, or
 * a query/index embedding-dimension mismatch.
 */
export async function semanticSearch(vault: Vault, query: string, limit = 10): Promise<SearchHit[]> {
  const lexical = search(vault, query, { limit: limit * 4 });
  const provider = getProvider(vault.config);
  const vectors = loadVectors(vault);
  if (!provider || !vectors) return lexical.slice(0, limit);

  const [queryVec] = await provider.embed([query]);
  if (!queryVec || (vectors.dim > 0 && queryVec.length !== vectors.dim)) return lexical.slice(0, limit);

  const semanticRanked = Object.entries(vectors.vectors)
    .map(([id, vec]) => ({ id, sim: cosine(queryVec, vec) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, limit * 4)
    .map((r) => r.id);

  const fused = fuseScored(lexical.map((h) => h.id), semanticRanked);
  const byId = new Map(lexical.map((h) => [h.id, h]));

  const out: SearchHit[] = [];
  for (const [id, rrf] of fused) {
    const lex = byId.get(id);
    if (lex) {
      out.push({ ...lex, score: rrf });
    } else {
      const m = getMemory(vault, id);
      if (!m) continue;
      out.push({
        id,
        path: m.path,
        title: m.frontmatter.title,
        tier: m.frontmatter.tier,
        score: rrf,
        snippet: (m.frontmatter.summary || m.body).replace(/\s+/g, " ").trim().slice(0, 160),
      });
    }
    if (out.length >= limit) break;
  }
  return out;
}
