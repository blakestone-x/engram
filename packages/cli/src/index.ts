#!/usr/bin/env node
/**
 * Engram CLI. A thin, scriptable surface over @engram/core. Every command
 * resolves the nearest vault (walking up from the cwd) unless a directory is
 * given. Output is plain text by default and JSON with `--json` where it makes
 * sense, so the CLI composes in agent pipelines.
 */

import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { Command } from "commander";
import pc from "picocolors";
import Table from "cli-table3";
import {
  addMemory,
  buildIndex,
  createServer,
  doctor,
  findVaultRoot,
  initVault,
  openVault,
  packContext,
  recall,
  reinforce,
  runConsolidation,
  runDecay,
  search,
  updateMemory,
  vaultStats,
  type Tier,
  type Vault,
} from "@engram/core";

const program = new Command();

function resolveVault(dir?: string): Vault {
  const root = dir ? resolve(dir) : findVaultRoot();
  if (!root) {
    console.error(pc.red("No Engram vault found. Run `engram init` here first."));
    process.exit(1);
  }
  return openVault(root);
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function retentionColor(r: number): (s: string) => string {
  if (r < 0.15) return pc.red;
  if (r < 0.4) return pc.yellow;
  return pc.green;
}

program
  .name("engram")
  .description("Local-first, markdown-native memory for AI agents.")
  .version("0.2.0");

program
  .command("init")
  .argument("[dir]", "vault directory", ".")
  .description("Create a new vault (config, tier directories, a sample memory)")
  .action((dir: string) => {
    const vault = initVault(resolve(dir));
    addMemory(vault, {
      title: "Welcome to Engram",
      tier: "semantic",
      type: "note",
      importance: 9,
      tags: ["engram", "getting-started"],
      summary: "Engram stores agent memory as markdown with a forgetting curve.",
      body:
        "This is a memory. It lives as a markdown file with YAML frontmatter.\n\n" +
        "Edit it, add your own with `engram add`, search with `engram search`,\n" +
        "and reinforce the ones that matter with `engram reinforce`. Memories you\n" +
        "never touch will decay and eventually be deprecated — that is the point.",
    });
    buildIndex(vault, true);
    console.log(pc.green(`Initialized Engram vault at ${vault.root}`));
    console.log(pc.dim("Next: engram status   ·   engram add -t \"...\" --tier working   ·   engram panel"));
  });

program
  .command("add")
  .description("Add a memory")
  .requiredOption("-t, --title <title>", "memory title")
  .option("--tier <tier>", "working | episodic | semantic | procedural", "working")
  .option("--type <type>", "note | fact | decision | error | reference | observation", "note")
  .option("-i, --importance <n>", "importance 1-10", "5")
  .option("--tags <tags>", "comma-separated tags")
  .option("-s, --summary <summary>", "one-line summary")
  .option("-b, --body <body>", "memory body, or '-' to read stdin")
  .option("-d, --dir <dir>", "vault directory")
  .action((opts) => {
    const vault = resolveVault(opts.dir);
    const body = opts.body === "-" ? readStdin() : opts.body ?? "";
    const memory = addMemory(vault, {
      title: opts.title,
      tier: opts.tier as Tier,
      type: opts.type,
      importance: Number(opts.importance),
      tags: opts.tags ? String(opts.tags).split(",").map((s: string) => s.trim()) : [],
      summary: opts.summary,
      body,
    });
    console.log(pc.green(`Added ${pc.bold(memory.frontmatter.id)}  ${memory.path}`));
  });

program
  .command("search")
  .argument("<query...>", "query terms")
  .description("BM25 search across the vault")
  .option("--tier <tier>", "filter by tier")
  .option("--type <type>", "filter by type")
  .option("--status <status>", "filter by status")
  .option("--limit <n>", "max results", "10")
  .option("--json", "output JSON")
  .option("-d, --dir <dir>", "vault directory")
  .action((query: string[], opts) => {
    const vault = resolveVault(opts.dir);
    const hits = search(vault, query.join(" "), {
      tier: opts.tier,
      type: opts.type,
      status: opts.status,
      limit: Number(opts.limit),
    });
    if (opts.json) return console.log(JSON.stringify(hits, null, 2));
    if (hits.length === 0) return console.log(pc.dim("No matches."));
    for (const h of hits) {
      console.log(`${pc.red(h.score.toFixed(2))}  ${pc.bold(h.title)} ${pc.dim(`[${h.tier}] ${h.id}`)}`);
      console.log(`     ${pc.dim(h.snippet)}`);
    }
  });

program
  .command("recall")
  .argument("<query...>", "query terms")
  .description("Agent-facing retrieval: relevance blended with retention and reinforcement")
  .option("--limit <n>", "max results", "10")
  .option("--as-of <date>", "evaluate memory as of a past date (YYYY-MM-DD)")
  .option("--include-deprecated", "include deprecated/superseded memories")
  .option("--json", "output JSON")
  .option("-d, --dir <dir>", "vault directory")
  .action((query: string[], opts) => {
    const vault = resolveVault(opts.dir);
    const asOf = opts.asOf ? new Date(`${String(opts.asOf).slice(0, 10)}T00:00:00Z`) : undefined;
    const hits = recall(vault, query.join(" "), {
      limit: Number(opts.limit),
      asOf,
      includeDeprecated: Boolean(opts.includeDeprecated),
    });
    if (opts.json) return console.log(JSON.stringify(hits, null, 2));
    if (hits.length === 0) return console.log(pc.dim("No matches."));
    for (const h of hits) {
      const rc = retentionColor(h.retention);
      console.log(`${pc.red(h.finalScore.toFixed(2))}  ${pc.bold(h.title)} ${pc.dim(`[${h.tier}]`)} ${rc(pct(h.retention))} ${pc.dim(`×${h.strength}`)}`);
    }
  });

program
  .command("context")
  .argument("<query...>", "query terms")
  .description("Pack a token-budgeted block of the most relevant memories for prompt injection")
  .option("--budget <n>", "approximate token budget", "1500")
  .option("--tier <tier>", "restrict to one tier")
  .option("--body", "include a short body excerpt under each entry")
  .option("--json", "output JSON (text + used + tokensEstimate)")
  .option("-d, --dir <dir>", "vault directory")
  .action((query: string[], opts) => {
    const vault = resolveVault(opts.dir);
    const pack = packContext(vault, query.join(" "), {
      budget: Number(opts.budget),
      tier: opts.tier as Tier | undefined,
      includeBody: Boolean(opts.body),
    });
    if (opts.json) return console.log(JSON.stringify(pack, null, 2));
    if (pack.used.length === 0) return console.log(pc.dim("No relevant memories."));
    console.log(pack.text);
    console.log(pc.dim(`\n  ${pack.used.length} memories · ~${pack.tokensEstimate} tokens`));
  });

program
  .command("reinforce")
  .argument("<ids...>", "memory ids to reinforce")
  .description("Bump strength and reset the decay clock (spaced repetition)")
  .option("-d, --dir <dir>", "vault directory")
  .action((ids: string[], opts) => {
    const vault = resolveVault(opts.dir);
    const updated = reinforce(vault, ids);
    if (updated.length === 0) return console.log(pc.yellow("No matching memories."));
    for (const m of updated) {
      console.log(pc.green(`Reinforced ${m.frontmatter.id}  ${pc.bold(m.frontmatter.title)}  → strength ${m.frontmatter.strength}`));
    }
  });

program
  .command("decay")
  .description("Run the forgetting pass (dry-run unless --apply)")
  .option("--apply", "deprecate forgettable memories")
  .option("--json", "output JSON")
  .option("-d, --dir <dir>", "vault directory")
  .action((opts) => {
    const vault = resolveVault(opts.dir);
    const summary = runDecay(vault, { apply: Boolean(opts.apply) });
    if (opts.json) return console.log(JSON.stringify(summary, null, 2));
    console.log(
      `Evaluated ${pc.bold(String(summary.evaluated))} · forgettable ${pc.red(String(summary.forgettable))} · ` +
        (summary.applied ? `${pc.red(`deprecated ${summary.deprecated}`)}` : pc.dim("dry-run (use --apply)")),
    );
    for (const r of summary.rows.filter((x) => x.forgettable)) {
      console.log(`  ${pc.red(pct(r.retention))}  ${r.title} ${pc.dim(`[${r.tier}] ${r.id}`)}`);
    }
  });

program
  .command("consolidate")
  .description("Cluster aged, reinforced episodic memories into semantic ones (dry-run unless --apply)")
  .option("--apply", "write consolidated semantic memories")
  .option("--json", "output JSON")
  .option("-d, --dir <dir>", "vault directory")
  .action((opts) => {
    const vault = resolveVault(opts.dir);
    const summary = runConsolidation(vault, { apply: Boolean(opts.apply) });
    if (opts.json) return console.log(JSON.stringify(summary, null, 2));
    console.log(
      `Eligible ${pc.bold(String(summary.eligible))} · clusters ${pc.bold(String(summary.clusters.length))} · ` +
        (summary.applied ? pc.green(`written ${summary.written}`) : pc.dim("dry-run (use --apply)")),
    );
    summary.clusters.forEach((c, i) => {
      console.log(`  cluster ${i + 1}: ${c.sourceIds.length} sources · ${pc.dim(c.sharedTokens.join(", "))}`);
    });
  });

program
  .command("promote")
  .argument("<id>", "memory id")
  .description("Promote a semantic/episodic memory to procedural (an operating rule)")
  .option("-d, --dir <dir>", "vault directory")
  .action((id: string, opts) => {
    const vault = resolveVault(opts.dir);
    const updated = updateMemory(vault, id, (m) => {
      m.frontmatter.tier = "procedural";
      m.frontmatter.confidence = "high";
    });
    if (!updated) return console.log(pc.yellow("No matching memory."));
    console.log(pc.green(`Promoted ${updated.frontmatter.id} → procedural`));
  });

program
  .command("status")
  .description("Vault dashboard")
  .option("-d, --dir <dir>", "vault directory")
  .action((opts) => {
    const vault = resolveVault(opts.dir);
    const stats = vaultStats(vault);
    console.log(pc.bold(`\n  Engram · ${vault.root}\n`));

    const tierTable = new Table({
      head: ["tier", "count"].map((h) => pc.dim(h)),
      chars: borderless(),
    });
    for (const [tier, count] of Object.entries(stats.byTier)) tierTable.push([tier, String(count)]);
    console.log(tierTable.toString());

    console.log(
      `\n  total ${pc.bold(String(stats.total))}` +
        `   avg retention ${retentionColor(stats.avgRetention)(pct(stats.avgRetention))}` +
        `   decaying soon ${stats.decayingSoon > 0 ? pc.red(String(stats.decayingSoon)) : pc.green("0")}`,
    );
    console.log(
      `  ${pc.dim("status:")} ` +
        Object.entries(stats.byStatus)
          .map(([s, n]) => `${s} ${n}`)
          .join("  "),
    );

    if (stats.recentlyReinforced.length) {
      console.log(pc.dim("\n  recently reinforced"));
      for (const r of stats.recentlyReinforced) {
        console.log(`    ${pc.red(`×${r.strength}`)} ${pc.bold(r.title)} ${pc.dim(r.last_reinforced)}`);
      }
    }
    console.log();
  });

program
  .command("reindex")
  .description("Rebuild the search index from the markdown sources")
  .option("-d, --dir <dir>", "vault directory")
  .action((opts) => {
    const vault = resolveVault(opts.dir);
    const index = buildIndex(vault, true);
    console.log(pc.green(`Indexed ${Object.keys(index.docs).length} memories.`));
  });

program
  .command("doctor")
  .description("Check vault integrity (exits non-zero on errors)")
  .option("-d, --dir <dir>", "vault directory")
  .action((opts) => {
    const vault = resolveVault(opts.dir);
    const report = doctor(vault);
    console.log(`Checked ${pc.bold(String(report.checked))} memories.`);
    for (const issue of report.issues) {
      const tag = issue.level === "error" ? pc.red("error") : pc.yellow("warn ");
      console.log(`  ${tag} ${pc.dim(issue.memory)}  ${issue.message}`);
    }
    if (report.ok) console.log(pc.green("No errors."));
    process.exit(report.ok ? 0 : 1);
  });

program
  .command("panel")
  .description("Launch the web control panel")
  .option("-p, --port <port>", "port", "4319")
  .option("-d, --dir <dir>", "vault directory")
  .action((opts) => {
    const vault = resolveVault(opts.dir);
    const staticDir = resolvePanelDist();
    const server = createServer(vault, staticDir ? { staticDir } : {});
    const port = Number(opts.port);
    server.listen(port, "127.0.0.1", () => {
      console.log(pc.bold(`\n  Engram control panel`));
      console.log(`  ${pc.red("▸")} http://127.0.0.1:${port}\n`);
      if (!staticDir) {
        console.log(pc.yellow("  Panel UI build not found — API is live; build @engram/panel to serve the UI.\n"));
      } else {
        console.log(pc.dim(`  serving ${staticDir}\n`));
      }
    });
  });

function resolvePanelDist(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve("@engram/panel/package.json");
    return join(dirname(pkg), "dist");
  } catch {
    return undefined;
  }
}

function borderless() {
  return {
    top: "",
    "top-mid": "",
    "top-left": "",
    "top-right": "",
    bottom: "",
    "bottom-mid": "",
    "bottom-left": "",
    "bottom-right": "",
    left: "  ",
    "left-mid": "",
    mid: "",
    "mid-mid": "",
    right: "",
    "right-mid": "",
    middle: "  ",
  };
}

program.parseAsync(process.argv);
