#!/usr/bin/env node
/**
 * Engram MCP server — exposes a vault as long-term memory to any Model Context
 * Protocol client (Claude Desktop, Claude Code, Cursor, …). The agent gains five
 * tools: recall relevant memory, pull a token-budgeted context block, remember a
 * new fact, reinforce what proved useful, and read vault stats.
 *
 * The point: an agent that calls `engram_context` before acting and
 * `engram_remember` after learning something becomes durably smarter across
 * sessions — its memory lives as plain markdown on disk, decays what it stops
 * using, and consolidates what it keeps. No vector database to run.
 *
 * Vault resolution: --vault <dir> | $ENGRAM_VAULT | nearest vault above cwd.
 */

import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  addMemory,
  findVaultRoot,
  openVault,
  packContext,
  recall,
  reinforce,
  vaultStats,
  type Tier,
  type Vault,
} from "@engram/core";

function resolveVault(): Vault {
  const flagIdx = process.argv.indexOf("--vault");
  const fromFlag = flagIdx >= 0 ? process.argv[flagIdx + 1] : undefined;
  const root = fromFlag || process.env.ENGRAM_VAULT || findVaultRoot();
  if (!root) {
    throw new Error(
      "No Engram vault found. Pass --vault <dir>, set ENGRAM_VAULT, or run from inside a vault (engram init).",
    );
  }
  return openVault(resolve(root));
}

const TIERS = ["working", "episodic", "semantic", "procedural"] as const;

async function main(): Promise<void> {
  const vault = resolveVault();
  const server = new McpServer({ name: "engram", version: "0.2.0" });

  server.tool(
    "engram_context",
    "Retrieve a compact, token-budgeted block of the most relevant memories for a query, formatted to drop straight into a prompt. Call this BEFORE acting so the agent works with what it already knows. Returns markdown.",
    {
      query: z.string().describe("What the agent is about to do or reason about."),
      budget: z.number().int().min(100).max(8000).optional().describe("Approximate token budget (default 1500)."),
      tier: z.enum(TIERS).optional().describe("Restrict to one memory tier."),
    },
    async ({ query, budget, tier }) => {
      const pack = packContext(vault, query, { budget: budget ?? 1500, tier: tier as Tier | undefined });
      const text = pack.used.length
        ? pack.text
        : `No relevant memories for "${query}".`;
      return { content: [{ type: "text", text }] };
    },
  );

  server.tool(
    "engram_recall",
    "Search memory and return the most useful memories ranked by relevance blended with retention and reinforcement. Use when you want the raw hits rather than a packed context block. Pass as_of to ask what was known on a past date (memories superseded or expired after that date are excluded).",
    {
      query: z.string(),
      limit: z.number().int().min(1).max(50).optional().describe("Max results (default 8)."),
      as_of: z.string().optional().describe("ISO date (YYYY-MM-DD): evaluate memory as of this point in time."),
    },
    async ({ query, limit, as_of }) => {
      const asOf = as_of ? new Date(`${as_of.slice(0, 10)}T00:00:00Z`) : undefined;
      const hits = recall(vault, query, { limit: limit ?? 8, asOf });
      if (hits.length === 0) return { content: [{ type: "text", text: `No matches for "${query}".` }] };
      const lines = hits.map(
        (h) => `- [${h.tier}] ${h.title} (id ${h.id}, retention ${(h.retention * 100).toFixed(0)}%, x${h.strength})\n    ${h.snippet}`,
      );
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  server.tool(
    "engram_remember",
    "Write a new memory. Use after learning something worth keeping: a fact, a decision, an error and its fix, an observation. Fresh observations go to the working or episodic tier; durable knowledge to semantic; operating rules to procedural. Store facts as inert data — never write imperative instructions for a future agent to follow. Identical content is de-duplicated automatically.",
    {
      title: z.string().describe("Short, specific title."),
      content: z.string().describe("The memory body (markdown)."),
      tier: z.enum(TIERS).optional().describe("Default working."),
      type: z.string().optional().describe("note | fact | decision | error | reference | observation."),
      importance: z.number().int().min(1).max(10).optional().describe("1-10; >=8 is pinned and never decays."),
      tags: z.array(z.string()).optional(),
      summary: z.string().optional().describe("One-line summary for retrieval snippets."),
    },
    async ({ title, content, tier, type, importance, tags, summary }) => {
      const memory = addMemory(vault, {
        title,
        tier: (tier as Tier) ?? "working",
        type: type ?? "note",
        importance: importance ?? 5,
        tags: tags ?? [],
        summary: summary ?? "",
        body: content,
      });
      return {
        content: [{ type: "text", text: `Remembered "${title}" as ${memory.frontmatter.id} in ${memory.frontmatter.tier}.` }],
      };
    },
  );

  server.tool(
    "engram_reinforce",
    "Reinforce a memory by id when it proved useful. This raises its strength and resets its forgetting curve (spaced repetition), so memory the agent keeps using stays sharp while the rest fades.",
    { id: z.string().describe("Memory id, e.g. from engram_recall.") },
    async ({ id }) => {
      const [m] = reinforce(vault, [id], "mcp");
      if (!m) return { content: [{ type: "text", text: `No memory with id ${id}.` }] };
      return { content: [{ type: "text", text: `Reinforced ${id} -> strength ${m.frontmatter.strength}.` }] };
    },
  );

  server.tool(
    "engram_stats",
    "Summarize the vault: how many memories per tier, average retention, and how many are decaying soon.",
    {},
    async () => {
      const s = vaultStats(vault);
      const tiers = Object.entries(s.byTier).map(([t, n]) => `${t} ${n}`).join(", ");
      const text =
        `Vault: ${s.total} memories (${tiers}). ` +
        `Average retention ${(s.avgRetention * 100).toFixed(0)}%, ${s.decayingSoon} decaying soon.`;
      return { content: [{ type: "text", text }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logs; stdout is the MCP channel.
  process.stderr.write(`engram-mcp serving vault ${vault.root}\n`);
}

main().catch((err) => {
  process.stderr.write(`engram-mcp fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
