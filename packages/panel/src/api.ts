/**
 * Typed fetch client for the @engram/core HTTP API. Same-origin, base "/api".
 * Mirrors the route table in packages/core/src/server.ts. The panel talks to
 * nothing else.
 */

export type Tier = "working" | "episodic" | "semantic" | "procedural";
export type MemoryStatus = "active" | "consolidated" | "deprecated" | "disputed";
export type Confidence = "high" | "medium" | "low";
export type LinkRel = "extends" | "informed_by" | "contradicts" | "related" | "supersedes";
export type RunKind = "decay" | "consolidate" | "reinforce" | "reindex";

export const TIERS: readonly Tier[] = ["working", "episodic", "semantic", "procedural"];

export interface Stats {
  total: number;
  byTier: Record<Tier, number>;
  byStatus: Record<MemoryStatus, number>;
  avgRetention: number;
  decayingSoon: number;
  recentlyReinforced: { id: string; title: string; strength: number; last_reinforced: string }[];
}

export interface MemoryListItem {
  id: string;
  title: string;
  tier: Tier;
  type: string;
  status: MemoryStatus;
  importance: number;
  strength: number;
  summary: string;
  path: string;
  retention: number;
}

export interface ResolvedLink {
  to: string;
  rel: LinkRel;
  title: string;
}

export interface MemoryDetail {
  id: string;
  title: string;
  tier: Tier;
  type: string;
  status: MemoryStatus;
  confidence: Confidence;
  importance: number;
  strength: number;
  created: string;
  last_reviewed: string;
  last_reinforced: string;
  tags: string[];
  summary: string;
  body: string;
  path: string;
  retention: number;
  links: ResolvedLink[];
}

export interface SearchHit {
  id: string;
  path: string;
  title: string;
  tier: Tier;
  score: number;
  snippet: string;
}

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

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface DecayRow {
  id: string;
  path: string;
  title: string;
  tier: Tier;
  retention: number;
  pinned: boolean;
  forgettable: boolean;
  daysUntilDeprecate: number | null;
}

export interface RunEvent {
  kind: RunKind;
  at: string;
  detail: Record<string, unknown>;
}

export interface DecaySummary {
  evaluated: number;
  forgettable: number;
  deprecated: number;
  applied: boolean;
  rows: DecayRow[];
}

export interface ConsolidationCluster {
  sharedTokens: string[];
  sourceIds: string[];
  writtenPath?: string;
}

export interface ConsolidationSummary {
  eligible: number;
  clusters: ConsolidationCluster[];
  written: number;
  applied: boolean;
}

export interface ReindexSummary {
  indexed: number;
}

export interface MemoryQuery {
  tier?: Tier | "";
  type?: string;
  status?: MemoryStatus | "";
  q?: string;
  sort?: "retention" | "strength" | "importance" | "title";
  limit?: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const api = {
  stats: () => request<Stats>("/api/stats"),

  memories: (query: MemoryQuery = {}) =>
    request<MemoryListItem[]>(
      "/api/memories" +
        qs({
          tier: query.tier,
          type: query.type,
          status: query.status,
          q: query.q,
          sort: query.sort,
          limit: query.limit,
        }),
    ),

  memory: (id: string) => request<MemoryDetail>(`/api/memories/${encodeURIComponent(id)}`),

  reinforce: (id: string) =>
    request<MemoryDetail>(`/api/memories/${encodeURIComponent(id)}/reinforce`, { method: "POST" }),

  search: (q: string, tier?: Tier | "", limit = 20) =>
    request<SearchHit[]>("/api/search" + qs({ q, tier, limit })),

  graph: () => request<GraphData>("/api/graph"),

  decay: () => request<DecayRow[]>("/api/decay"),

  runs: (limit = 50) => request<RunEvent[]>("/api/runs" + qs({ limit })),

  opDecay: (apply: boolean) =>
    request<DecaySummary>("/api/ops/decay", { method: "POST", body: JSON.stringify({ apply }) }),

  opConsolidate: (apply: boolean) =>
    request<ConsolidationSummary>("/api/ops/consolidate", {
      method: "POST",
      body: JSON.stringify({ apply }),
    }),

  opReindex: () => request<ReindexSummary>("/api/ops/reindex", { method: "POST" }),
};

/** Tier → CSS variable color name, shared by chips and graph. */
export const TIER_COLOR: Record<Tier, string> = {
  working: "var(--tier-working)",
  episodic: "var(--tier-episodic)",
  semantic: "var(--tier-semantic)",
  procedural: "var(--tier-procedural)",
};

/** Hex fallbacks for canvas/SVG where CSS vars don't resolve. */
export const TIER_HEX: Record<Tier, string> = {
  working: "#6ea8d8",
  episodic: "#c39bd3",
  semantic: "#7fbf9a",
  procedural: "#d8b06e",
};
