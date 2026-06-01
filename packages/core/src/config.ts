/** Vault configuration: defaults, validation, and load/save. */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { EngramConfig } from "./types.js";

export const ENGRAM_DIR = ".engram";
export const CONFIG_FILE = "config.json";

const tierStabilitySchema = z.object({
  working: z.number().min(0),
  episodic: z.number().min(0),
  semantic: z.number().min(0),
  procedural: z.number().min(0),
});

const decaySchema = z.object({
  baseStability: z.number().positive(),
  strengthWeight: z.number().min(0),
  importanceWeight: z.number().min(0),
  deprecateThreshold: z.number().gt(0).lt(1),
  pinThreshold: z.number().int().min(1).max(10),
  tierStability: tierStabilitySchema,
});

const consolidationSchema = z.object({
  minStrength: z.number().int().min(0),
  minAgeDays: z.number().min(0),
  clusterThreshold: z.number().gt(0).lt(1),
  minClusterSize: z.number().int().min(2),
  maxPerRun: z.number().int().min(1),
});

const configSchema = z.object({
  types: z.array(z.string()),
  decay: decaySchema,
  consolidation: consolidationSchema,
  search: z.object({
    k1: z.number().positive(),
    b: z.number().min(0).max(1),
    fieldWeights: z.object({ title: z.number().min(0), summary: z.number().min(0), body: z.number().min(0) }),
    stemming: z.boolean(),
  }),
  embeddings: z.object({
    provider: z.union([z.literal("openai"), z.null()]),
    model: z.string().optional(),
  }),
  redactPatterns: z.array(z.string()),
});

export const DEFAULT_CONFIG: EngramConfig = {
  types: ["note", "fact", "decision", "error", "reference", "observation"],
  decay: {
    baseStability: 14,
    strengthWeight: 0.8,
    importanceWeight: 0.15,
    deprecateThreshold: 0.15,
    pinThreshold: 8,
    // Tier half-life ladder: working fades fastest, procedural is near-permanent.
    tierStability: { working: 0.4, episodic: 1, semantic: 2.5, procedural: 8 },
  },
  consolidation: {
    minStrength: 2,
    minAgeDays: 14,
    clusterThreshold: 0.18,
    minClusterSize: 3,
    maxPerRun: 3,
  },
  search: {
    k1: 1.5,
    b: 0.75,
    fieldWeights: { title: 5, summary: 2, body: 1 },
    stemming: true,
  },
  embeddings: { provider: null },
  redactPatterns: [
    // Conservative defaults; users extend per vault.
    "AKIA[0-9A-Z]{16}", // AWS access key id
    "sk-[A-Za-z0-9]{20,}", // OpenAI-style secret key
    "ghp_[A-Za-z0-9]{36}", // GitHub PAT
    "-----BEGIN [A-Z ]*PRIVATE KEY-----",
  ],
};

export function configPath(root: string): string {
  return join(root, ENGRAM_DIR, CONFIG_FILE);
}

/** Load and validate a vault config, filling defaults for missing keys. */
export function loadConfig(root: string): EngramConfig {
  const path = configPath(root);
  if (!existsSync(path)) return structuredClone(DEFAULT_CONFIG);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const merged = mergeWithDefaults(raw);
  return configSchema.parse(merged);
}

export function saveConfig(root: string, config: EngramConfig): void {
  writeFileSync(configPath(root), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/** Deep-merge a partial config over defaults (one level into each section). */
function mergeWithDefaults(raw: unknown): EngramConfig {
  const r = (raw ?? {}) as Partial<EngramConfig>;
  return {
    types: r.types ?? DEFAULT_CONFIG.types,
    decay: { ...DEFAULT_CONFIG.decay, ...(r.decay ?? {}) },
    consolidation: { ...DEFAULT_CONFIG.consolidation, ...(r.consolidation ?? {}) },
    search: { ...DEFAULT_CONFIG.search, ...(r.search ?? {}) },
    embeddings: { ...DEFAULT_CONFIG.embeddings, ...(r.embeddings ?? {}) },
    redactPatterns: r.redactPatterns ?? DEFAULT_CONFIG.redactPatterns,
  };
}
