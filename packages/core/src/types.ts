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
}

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
  search: { k1: number; b: number };
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
}

export interface SearchHit {
  id: string;
  path: string;
  title: string;
  tier: Tier;
  score: number;
  snippet: string;
}

export interface IndexFile {
  version: number;
  builtAt: string;
  avgdl: number;
  /** documentId -> { len, tf: Record<term, count>, meta } */
  docs: Record<string, IndexedDoc>;
  /** term -> document frequency */
  df: Record<string, number>;
}

export interface IndexedDoc {
  id: string;
  path: string;
  title: string;
  tier: Tier;
  type: string;
  status: MemoryStatus;
  len: number;
  tf: Record<string, number>;
  text: string; // stored for snippet generation
}

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
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
