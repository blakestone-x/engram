/**
 * @engram/core — local-first, markdown-native memory for AI agents.
 *
 * Public surface: open/init a vault, read & write memories, search & recall,
 * run the Ebbinghaus decay and consolidation passes, and serve the control-panel
 * API. Everything is derived from `.md` files; the index is rebuildable.
 */

export * from "./types.js";

// Config
export { DEFAULT_CONFIG, ENGRAM_DIR, loadConfig, saveConfig, configPath } from "./config.js";

// Vault IO
export {
  openVault,
  initVault,
  isVault,
  findVaultRoot,
  listMemories,
  getMemory,
  addMemory,
  writeMemory,
  updateMemory,
  reinforce,
  appendRun,
  readRuns,
  slugify,
} from "./vault.js";

// Frontmatter
export { parseFrontmatter, serializeMemory, serialize, generateId, frontmatterFromInput } from "./frontmatter.js";

// Dates & tokens (useful to consumers building their own tooling)
export { today, nowISO, daysBetween, elapsedDays } from "./dates.js";
export { tokenize, jaccard } from "./tokens.js";

// Privacy
export { scrub } from "./privacy.js";

// Decay
export {
  retentionFor,
  stabilityFor,
  importanceFactor,
  tierFactor,
  isPinned,
  isExpired,
  daysUntilDeprecate,
  decayReport,
  runDecay,
} from "./decay.js";

// Consolidation
export { runConsolidation } from "./consolidate.js";

// Search & recall
export { buildIndex, ensureIndex, search, invalidateIndex } from "./search.js";
export { recall, type RecallHit, type RecallOptions } from "./recall.js";

// Context packing (token-budgeted retrieval for prompt injection)
export { packContext, estimateTokens } from "./context.js";

// Store cache control (mainly for tests / long-running hosts)
export { invalidateStore, refreshStore } from "./store.js";

// Optional semantic layer
export { getProvider, buildVectors, semanticSearch, fuse, OpenAIEmbeddingProvider } from "./embeddings.js";

// Stats, graph, doctor
export { vaultStats } from "./stats.js";
export { buildGraph } from "./graph.js";
export { doctor, type DoctorReport, type DoctorIssue } from "./doctor.js";

// Server
export { createServer } from "./server.js";
