/** Read and write memory frontmatter with a stable, canonical key order. */

import { randomBytes } from "node:crypto";
import matter from "gray-matter";
import YAML from "yaml";
import { today } from "./dates.js";
import type {
  Confidence,
  Frontmatter,
  Memory,
  MemoryInput,
  MemoryLink,
  MemoryStatus,
  Tier,
} from "./types.js";
import { TIERS } from "./types.js";

const STATUSES: MemoryStatus[] = ["active", "consolidated", "deprecated", "disputed"];
const CONFIDENCES: Confidence[] = ["high", "medium", "low"];

/** Stable 12-char hex id (48 bits; collision-safe well past 10^6 memories). */
export function generateId(): string {
  return randomBytes(6).toString("hex");
}

function asTier(value: unknown, fallback: Tier = "working"): Tier {
  return TIERS.includes(value as Tier) ? (value as Tier) : fallback;
}

function asStatus(value: unknown): MemoryStatus {
  return STATUSES.includes(value as MemoryStatus) ? (value as MemoryStatus) : "active";
}

function asConfidence(value: unknown): Confidence {
  return CONFIDENCES.includes(value as Confidence) ? (value as Confidence) : "medium";
}

function asInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Coerce a frontmatter date to `YYYY-MM-DD`. YAML auto-parses unquoted ISO
 * dates into `Date` objects, so we must accept those as well as strings.
 */
function asDateString(value: unknown, fallback: string): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string" && value.trim()) return value.slice(0, 10);
  return fallback;
}

/** Coerce an id-like value to a string (YAML may parse all-digit ids as numbers). */
function asId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function asLinks(value: unknown): MemoryLink[] {
  if (!Array.isArray(value)) return [];
  const out: MemoryLink[] = [];
  for (const item of value) {
    if (item && typeof item === "object" && "to" in item) {
      const to = String((item as Record<string, unknown>).to ?? "").trim();
      const rel = String((item as Record<string, unknown>).rel ?? "related").trim();
      if (to) out.push({ to, rel: rel as MemoryLink["rel"] });
    }
  }
  return out;
}

/**
 * Coerce arbitrary parsed YAML into a complete Frontmatter, filling defaults.
 * Tolerant by design: a hand-edited file with a missing field still loads.
 */
export function coerceFrontmatter(data: Record<string, unknown>, fallbackTitle: string): Frontmatter {
  const created = asDateString(data.created, today());
  const fm: Frontmatter = {
    id: asId(data.id) ?? generateId(),
    title: typeof data.title === "string" && data.title ? data.title : fallbackTitle,
    tier: asTier(data.tier),
    type: typeof data.type === "string" && data.type ? data.type : "note",
    status: asStatus(data.status),
    confidence: asConfidence(data.confidence),
    importance: asInt(data.importance, 5, 1, 10),
    strength: asInt(data.strength, 0, 0, Number.MAX_SAFE_INTEGER),
    created,
    last_reviewed: asDateString(data.last_reviewed, created),
    last_reinforced: asDateString(data.last_reinforced, created),
    tags: asStringArray(data.tags),
    links: asLinks(data.links),
    summary: typeof data.summary === "string" ? data.summary : "",
  };
  if (data.valid_until instanceof Date || (typeof data.valid_until === "string" && data.valid_until.trim())) {
    fm.valid_until = asDateString(data.valid_until, "");
  }
  const superseded = asId(data.superseded_by);
  if (superseded) fm.superseded_by = superseded;
  if (typeof data.scope === "string" && data.scope.trim()) fm.scope = data.scope.trim();
  if (typeof data.author === "string" && data.author.trim()) fm.author = data.author.trim();
  if (data.visibility === "private" || data.visibility === "shared" || data.visibility === "global") {
    fm.visibility = data.visibility;
  }
  return fm;
}

/** Build a complete Frontmatter from user input, generating id/dates. */
export function frontmatterFromInput(input: MemoryInput): Frontmatter {
  const now = today();
  const fm: Frontmatter = {
    id: input.id ?? generateId(),
    title: input.title,
    tier: input.tier,
    type: input.type ?? "note",
    status: input.status ?? "active",
    confidence: input.confidence ?? "medium",
    importance: asInt(input.importance, 5, 1, 10),
    strength: 0,
    created: now,
    last_reviewed: now,
    last_reinforced: now,
    tags: input.tags ?? [],
    links: input.links ?? [],
    summary: input.summary ?? "",
  };
  if (input.valid_until) fm.valid_until = input.valid_until.slice(0, 10);
  if (input.scope) fm.scope = input.scope;
  if (input.author) fm.author = input.author;
  if (input.visibility) fm.visibility = input.visibility;
  return fm;
}

/** Parse a raw `.md` string into frontmatter + body. */
export function parseFrontmatter(raw: string, fallbackTitle: string): { frontmatter: Frontmatter; body: string } {
  const parsed = matter(raw);
  return {
    frontmatter: coerceFrontmatter(parsed.data as Record<string, unknown>, fallbackTitle),
    body: parsed.content.replace(/^\n+/, "").trimEnd(),
  };
}

const KEY_ORDER: (keyof Frontmatter)[] = [
  "id", "title", "tier", "type", "status", "confidence", "importance", "strength",
  "created", "last_reviewed", "last_reinforced", "tags", "links", "summary",
];

/** Serialize frontmatter + body to a canonical `.md` string. */
export function serializeMemory(frontmatter: Frontmatter, body: string): string {
  const ordered: Record<string, unknown> = {};
  for (const key of KEY_ORDER) ordered[key] = frontmatter[key];
  // Optional bi-temporal + multi-agent fields are emitted only when set.
  if (frontmatter.valid_until) ordered.valid_until = frontmatter.valid_until;
  if (frontmatter.superseded_by) ordered.superseded_by = frontmatter.superseded_by;
  if (frontmatter.scope) ordered.scope = frontmatter.scope;
  if (frontmatter.author) ordered.author = frontmatter.author;
  if (frontmatter.visibility) ordered.visibility = frontmatter.visibility;
  const yaml = YAML.stringify(ordered, { lineWidth: 0 }).trimEnd();
  const cleanBody = body.replace(/^\n+/, "").trimEnd();
  return `---\n${yaml}\n---\n\n${cleanBody}\n`;
}

/** Convenience: serialize a whole Memory object. */
export function serialize(memory: Pick<Memory, "frontmatter" | "body">): string {
  return serializeMemory(memory.frontmatter, memory.body);
}
