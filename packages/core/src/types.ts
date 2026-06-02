/**
 * Engram core — shared type contract.
 *
 * This module is the authoritative shape of every value that crosses a module
 * boundary in the engine. Implementations (vault, index, decay, consolidate,
 * server) and consumers (cli, panel) all import from here. See SPEC.md.
 */

/** The four cognitive tiers, ordered from most volatile to most durable. */
export type Tier = "working" | "episodic" | "semantic" | "procedural";

export const TIERS: readonly Tier[] = ["working", "episodic", "semantic", "procedural"];

export type MemoryStatus = "active" | "consolidated" | "deprecated" | "disputed";

export type Confidence = "high" | "medium" | "low";

/** Typed relation between two memories. */
export type LinkRel = "extends" | "informed_by" | "contradicts" | "related" | "supersedes";

export interface MemoryLink {
  /** Target memory id (preferred) or vault-relative path. */
  to: string;
  rel: LinkRel;
}

/** Parsed YAML frontmatter of a memory file. Dates are ISO `YYYY-MM-DD` strings. */
export interface Frontmatter {
  id: string;
  title: string;
  tier: Tier;
  type: string;
  status: MemoryStatus;
  confidence: Confidence;
  importance: number; // 1-10
  strength: number; // reinforcement count, >= 0
  created: string;
  last_reviewed: string;
  last_reinforced: string;
  tags: string[];
  links: MemoryLink[];
  summary: string;
  /** Optional bi-temporal validity: the fact stops being "true" after this date. */
  valid_until?: string;
  /** Set when another memory superseded this one (non-lossy retirement). */
  superseded_by?: string;
  /** Multi-agent namespace this memory belongs to (absent = global / unscoped). */
  scope?: string;
  /** Who wrote this memory (agent or user id) — provenance for audit. */
  author?: string;
  /** Visibility within multi-agent use. */
  visibility?: Visibility;
}

/** Multi-agent visibility of a memory within and across namespaces. */
export type Visibility = "private" | "shared" | "global";

/** A memory loaded from disk: frontmatter + body + location. */
export interface Memory {
  frontmatter: Frontmatter;
  body: string;
  /** Vault-relative POSIX path, e.g. "episodic/2026-05-31-thing.md". */
  path: string;
  /** Absolute path on disk. */
  absPath: string;
}

/** Frontmatter as accepted by `addMemory` — only title+tier required. */
export interface MemoryInput {
  title: string;
  tier: Tier;
  type?: string;
  status?: MemoryStatus;
  confidence?: Confidence;
  importance?: number;
  tags?: string[];
  links?: MemoryLink[];
  summary?: string;
  body?: string;
  /** Optional explicit id; generated when omitted. */
  id?: string;
  /** Optional bi-temporal validity end date. */
  valid_until?: string;
  /** Skip content-hash dedup and always write a new file. */
  allowDuplicate?: boolean;
  /** Multi-agent namespace. */
  scope?: string;
  /** Provenance: who wrote this memory. */
  author?: string;
  /** Visibility within multi-agent use. */
  visibility?: Visibility;
}

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

export interface DecayConfig {
  /** Baseline stability in days for a neutral memory (importance 5, strength 0). */
  baseStability: number;
  /** How much each reinforcement extends stability. */
  strengthWeight: number;
  /** How much importance (relative to 5) extends/shortens stability. */
  importanceWeight: number;
  /** Retention below this (and unpinned) makes a memory forgettable. 0..1. */
  deprecateThreshold: number;
  /** importance >= this is pinned: reported but never auto-deprecated. */
  pinThreshold: number;
  /**
   * Per-tier stability multiplier. The tiers are a half-life ladder: working
   * memory is volatile, procedural rules are effectively permanent. A multiplier
   * of 0 (or omitted → 1) means the tier uses base stability unchanged.
   */
  tierStability: Record<Tier, number>;
}

export interface ConsolidationConfig {
  minStrength: number;
  minAgeDays: number;
  clusterThreshold: number; // Jaccard
  minClusterSize: number;
  maxPerRun: number;
}

export interface EmbeddingsConfig {
  /** null = lexical-only, fully offline. "openai" enables the gated provider. */
  provider: "openai" | null;
  model?: string;
}

export interface EngramConfig {
  /** Allowed `type` values for memories (purely advisory; doctor warns on others). */
  types: string[];
  decay: DecayConfig;
  consolidation: ConsolidationConfig;
  search: {
    k1: number;
    b: number;
    /** BM25F per-field weights (title matters more than body). */
    fieldWeights: FieldWeights;
    /** Apply Porter stemming to tokens so word variants match. */
    stemming: boolean;
  };
  embeddings: EmbeddingsConfig;
  /** Patterns the privacy scrub redacts before write. */
  redactPatterns: string[];
}

// ----------------------------------------------------------------------------
// Vault handle
// ----------------------------------------------------------------------------

/** An opened vault: its root and resolved config. Carries no live file handles. */
export interface Vault {
  root: string; // absolute
  config: EngramConfig;
}

// ----------------------------------------------------------------------------
// Decay
// ----------------------------------------------------------------------------

export interface RetentionResult {
  id: string;
  path: string;
  title: string;
  tier: Tier;
  retention: number; // 0..1
  pinned: boolean;
  forgettable: boolean;
  /** Days until retention crosses the deprecate threshold; null if pinned/already past. */
  daysUntilDeprecate: number | null;
}

export interface DecayRunSummary {
  evaluated: number;
  forgettable: number;
  deprecated: number; // actually changed (0 in dry run)
  applied: boolean;
  rows: RetentionResult[];
}

// ----------------------------------------------------------------------------
// Consolidation
// ----------------------------------------------------------------------------

export interface ConsolidationCluster {
  sharedTokens: string[];
  sourceIds: string[];
  /** Set only after apply: the path of the written semantic memory. */
  writtenPath?: string;
}

export interface ConsolidationRunSummary {
  eligible: number;
  clusters: ConsolidationCluster[];
  written: number; // 0 in dry run
  applied: boolean;
}

// ----------------------------------------------------------------------------
// Search / retrieval
// ----------------------------------------------------------------------------

export interface SearchOptions {
  tier?: Tier;
  type?: string;
  status?: MemoryStatus;
  limit?: number;
  /** Include deprecated/superseded memories (default false unless `status` is set). */
  includeDeprecated?: boolean;
}

export interface FieldWeights {
  title: number;
  summary: number;
  body: number;
}

export interface SearchHit {
  id: string;
  path: string;
  title: string;
  tier: Tier;
  score: number;
  snippet: string;
}

export interface FieldStats<T> {
  title: T;
  summary: T;
  body: T;
}

export interface IndexFile {
  version: number;
  builtAt: string;
  count: number;
  /** Average length per field, for BM25F length normalization. */
  fieldAvgdl: FieldStats<number>;
  docs: Record<string, IndexedDoc>;
  /** term -> combined document frequency (term present in any field of the doc). */
  df: Record<string, number>;
}

export interface IndexedDoc {
  id: string;
  path: string;
  title: string;
  tier: Tier;
  type: string;
  status: MemoryStatus;
  /** File mtimeMs at index time, for incremental staleness detection. */
  mtime: number;
  fieldLen: FieldStats<number>;
  /** Per-field term frequencies for BM25F. */
  tf: FieldStats<Record<string, number>>;
  text: string; // stored for snippet generation
}

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

// ----------------------------------------------------------------------------
// Context packing
// ----------------------------------------------------------------------------

export interface ContextEntry {
  id: string;
  title: string;
  tier: Tier;
  retention: number;
}

export interface ContextPack {
  /** The formatted markdown block (empty string when nothing matched). */
  text: string;
  used: ContextEntry[];
  /** Rough token estimate of `text` (~4 chars/token). */
  tokensEstimate: number;
  /** How many candidate memories were left out (budget, item cap, or dedup). */
  dropped: number;
}

export interface PackOptions {
  /** Approximate token budget for the whole block. Default 1500. */
  budget?: number;
  /** Hard cap on the number of memories included. Default 12. */
  maxItems?: number;
  tier?: Tier;
  /** Restrict to a namespace (plus global/unscoped memories). */
  scope?: string;
  /** Include a short body excerpt under each entry. Default false (summaries only). */
  includeBody?: boolean;
  /** Override the header line. */
  header?: string;
}

// ----------------------------------------------------------------------------
// Graph (panel)
// ----------------------------------------------------------------------------

export interface GraphNode {
  id: string;
  title: string;
  tier: Tier;
  strength: number;
  retention: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  rel: LinkRel;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ----------------------------------------------------------------------------
// Stats / runs (panel + cli status)
// ----------------------------------------------------------------------------

export interface VaultStats {
  total: number;
  byTier: Record<Tier, number>;
  byStatus: Record<MemoryStatus, number>;
  avgRetention: number;
  decayingSoon: number; // active, unpinned, forgettable-within-window
  recentlyReinforced: { id: string; title: string; strength: number; last_reinforced: string }[];
}

export type RunEventKind = "decay" | "consolidate" | "reinforce" | "reindex";

export interface RunEvent {
  kind: RunEventKind;
  at: string; // ISO timestamp
  detail: Record<string, unknown>;
}
