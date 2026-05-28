/**
 * Optional semantic layer. Engram is fully functional offline with BM25 alone;
 * wiring an embedding provider adds a vector index and lets `semanticSearch`
 * fuse lexical and semantic ranks via Reciprocal Rank Fusion. Nothing here runs
 * unless `config.embeddings.provider` is set, so the default path makes zero
 * network calls.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ENGRAM_DIR } from "./config.js";
import { search } from "./search.js";
import { listMemories } from "./vault.js";
import type { EmbeddingProvider, EngramConfig, SearchHit, Vault } from "./types.js";

interface VectorFile {
  model: string;
  builtAt: string;
  vectors: Record<string, number[]>; // memory id -> embedding
}

function vectorsPath(vault: Vault): string {
  return join(vault.root, ENGRAM_DIR, "vectors.json");
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

/** Build and persist the vector index. No-op (returns 0) without a provider. */
export async function buildVectors(vault: Vault): Promise<number> {
  const provider = getProvider(vault.config);
  if (!provider) return 0;
  const memories = listMemories(vault);
  const ids = memories.map((m) => m.frontmatter.id);
  const inputs = memories.map((m) => `${m.frontmatter.title}\n${m.frontmatter.summary}\n${m.body}`.slice(0, 8000));
  const embeddings = await provider.embed(inputs);

  const file: VectorFile = {
    model: vault.config.embeddings.model ?? "text-embedding-3-small",
    builtAt: new Date().toISOString(),
    vectors: Object.fromEntries(ids.map((id, i) => [id, embeddings[i] ?? []])),
  };
  const path = vectorsPath(vault);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(file), "utf8");
  return ids.length;
}

function loadVectors(vault: Vault): VectorFile | null {
  const path = vectorsPath(vault);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as VectorFile;
  } catch {
    return null;
  }
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

/** Reciprocal Rank Fusion of two ranked id lists. */
export function fuse(lexical: string[], semantic: string[], k = 60): string[] {
  const score = new Map<string, number>();
  const add = (ids: string[]) => {
    ids.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + 1 / (k + rank + 1)));
  };
  add(lexical);
  add(semantic);
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/**
 * Hybrid retrieval: BM25 fused with vector cosine when a vector index exists.
 * Falls back to pure lexical search when there is no provider or no vectors.
 */
export async function semanticSearch(vault: Vault, query: string, limit = 10): Promise<SearchHit[]> {
  const lexical = search(vault, query, { limit: limit * 3 });
  const provider = getProvider(vault.config);
  const vectors = loadVectors(vault);
  if (!provider || !vectors) return lexical.slice(0, limit);

  const [queryVec] = await provider.embed([query]);
  if (!queryVec) return lexical.slice(0, limit);

  const semanticRanked = Object.entries(vectors.vectors)
    .map(([id, vec]) => ({ id, sim: cosine(queryVec, vec) }))
    .sort((a, b) => b.sim - a.sim)
    .map((r) => r.id);

  const fused = fuse(lexical.map((h) => h.id), semanticRanked.slice(0, limit * 3));
  const byId = new Map(lexical.map((h) => [h.id, h]));
  const out: SearchHit[] = [];
  for (const id of fused) {
    const hit = byId.get(id);
    if (hit) out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}
