#!/usr/bin/env node
// @ts-check

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { createServer, openVault } from "@engram/core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const MCP = join(ROOT, "packages", "mcp", "dist", "index.js");
const FIXTURE = join(ROOT, "examples", "starter-vault");
const TOOLS = new Set([
  "engram_context", "engram_recall", "engram_remember",
  "engram_reinforce", "engram_stats",
]);
const Recall = z.array(z.object({
  id: z.string(), title: z.string(), strength: z.number(),
}));
const Context = z.object({
  text: z.string(), used: z.array(z.object({ id: z.string() })),
});
const Decay = z.object({ applied: z.boolean(), deprecated: z.number() });
const Consolidation = z.object({
  applied: z.boolean(), written: z.number(), eligible: z.number(),
  clusters: z.array(z.unknown()),
});
const Stats = z.object({ total: z.number() });
const ToolResult = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
});

/** @param {string[]} args @returns {string} */
function cli(args) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd: ROOT, encoding: "utf8", timeout: 15_000, windowsHide: true,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
}

/** @param {string} raw @returns {unknown} */
function decode(raw) {
  return JSON.parse(raw);
}

/** @param {string} root @returns {string} */
function snapshot(root) {
  /** @type {string[]} */
  const rows = [];
  /** @param {string} directory */
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        const path = relative(root, absolute).split(sep).join("/");
        const hash = createHash("sha256").update(readFileSync(absolute)).digest("hex");
        rows.push(path + "\0" + hash);
      } else throw new Error("Unexpected fixture entry: " + absolute);
    }
  }
  walk(root);
  return rows.sort().join("\n");
}

/** @param {Client} client @param {string} name @param {Record<string, unknown>} args */
async function callTool(client, name, args) {
  const result = ToolResult.parse(await client.callTool(
    { name, arguments: args }, undefined, { timeout: 5_000 },
  ));
  assert.notEqual(result.isError, true, name + " returned an MCP error");
  const text = result.content.map((item) => item.text).join("\n");
  assert.ok(text, name + " returned no text");
  return text;
}

/** @param {import("node:http").Server} server @returns {Promise<number>} */
async function listen(server) {
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => resolvePromise(undefined));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

/** @param {import("node:http").Server} server */
async function closeServer(server) {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => error ? rejectPromise(error) : resolvePromise(undefined));
  });
}

/** @param {string} url */
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  assert.equal(response.status, 200, url + " returned HTTP " + response.status);
  return response;
}

async function main() {
  const tempParent = resolve(tmpdir());
  const temporaryRoot = mkdtempSync(join(tempParent, "engram-smoke-"));
  try {
    const starter = join(temporaryRoot, "starter-vault");
    const panelVault = join(temporaryRoot, "panel-vault");
    const cliVault = join(temporaryRoot, "cli-vault");
    const mcpVault = join(temporaryRoot, "mcp-vault");
    cpSync(FIXTURE, starter, { recursive: true });
    cpSync(FIXTURE, panelVault, { recursive: true });

    cli(["init", cliVault]);
    cli([
      "add", "--dir", cliVault, "--title", "Smoke beacon memory",
      "--tier", "episodic", "--importance", "6",
      "--summary", "A unique smoke beacon for retrieval.",
      "--body", "The smoke beacon survives recall and reinforcement.",
    ]);
    const hits = Recall.parse(decode(cli(["recall", "smoke beacon", "--json", "--dir", cliVault])));
    const hit = hits.find((item) => item.title === "Smoke beacon memory");
    assert.ok(hit, "CLI recall omitted the new memory");
    const context = Context.parse(decode(cli([
      "context", "smoke beacon", "--budget", "300", "--json", "--dir", cliVault,
    ])));
    assert.match(context.text, /Smoke beacon memory/);
    assert.ok(context.used.some((entry) => entry.id === hit.id));
    cli(["reinforce", hit.id, "--dir", cliVault]);
    const after = Recall.parse(decode(cli(["recall", "smoke beacon", "--json", "--dir", cliVault])));
    assert.equal(after.find((entry) => entry.id === hit.id)?.strength, hit.strength + 1);
    console.log("CLI init, write, recall, context, and reinforcement passed");

    const before = snapshot(starter);
    assert.match(cli(["doctor", "--dir", starter]), /Checked 14 memories\./);
    const decay = Decay.parse(decode(cli(["decay", "--json", "--dir", starter])));
    assert.equal(decay.applied, false);
    assert.equal(decay.deprecated, 0);
    const consolidation = Consolidation.parse(decode(cli(["consolidate", "--json", "--dir", starter])));
    assert.equal(consolidation.applied, false);
    assert.equal(consolidation.written, 0);
    assert.ok(consolidation.eligible > 0 && consolidation.clusters.length > 0);
    assert.equal(snapshot(starter), before, "Dry-run changed starter-vault files");
    console.log("Starter vault: 14 memories, integrity, clusters, and unchanged dry-runs passed");

    cli(["init", mcpVault]);
    const transport = new StdioClientTransport({
      command: process.execPath, args: [MCP, "--vault", mcpVault],
    });
    const client = new Client({ name: "engram-smoke", version: "0.0.0" });
    let connected = false;
    try {
      await client.connect(transport, { timeout: 10_000 });
      connected = true;
      const listed = await client.listTools(undefined, { timeout: 5_000 });
      assert.deepEqual(new Set(listed.tools.map((tool) => tool.name)), TOOLS);
      const remembered = await callTool(client, "engram_remember", {
        title: "MCP smoke memory", content: "A memory written through real MCP stdio.",
        tier: "episodic", importance: 6, summary: "MCP stdio smoke memory.",
      });
      const id = /as ([A-Za-z0-9_-]+) in /.exec(remembered)?.[1];
      assert.ok(id, "MCP remember omitted its memory ID");
      const recalled = await callTool(client, "engram_recall", { query: "MCP smoke memory" });
      assert.ok(recalled.includes("MCP smoke memory") && recalled.includes(id));
      assert.match(await callTool(client, "engram_context", {
        query: "MCP smoke memory", budget: 300,
      }), /MCP smoke memory/);
      assert.match(await callTool(client, "engram_reinforce", { id }), /strength 1/);
      assert.match(await callTool(client, "engram_recall", { query: "MCP smoke memory" }), /x1\)/);
      assert.match(await callTool(client, "engram_stats", {}), /^Vault: 2 memories/);
    } finally {
      await (connected ? client.close() : transport.close());
    }
    console.log("MCP stdio initialize, tool discovery, and all five tools passed");

    const server = createServer(openVault(panelVault), {
      staticDir: join(ROOT, "packages", "panel", "dist"),
    });
    try {
      const port = await listen(server);
      const base = "http://127.0.0.1:" + port + "/";
      const index = await (await get(base)).text();
      assert.match(index, /<title>Engram<\/title>/);
      const assetPath = /(?:src|href)="([^"]*assets\/[^"]+\.js)"/.exec(index)?.[1];
      assert.ok(assetPath, "Panel index omitted its built JavaScript asset");
      const asset = await get(new URL(assetPath, base).href);
      assert.match(asset.headers.get("content-type") ?? "", /javascript/);
      assert.ok((await asset.text()).length > 0);
      const stats = Stats.parse(await (await get(base + "api/stats")).json());
      assert.equal(stats.total, 14);
    } finally {
      await closeServer(server);
    }
    console.log("Panel HTML, built JavaScript, and 14-memory HTTP response passed");
    console.log("Engram smoke passed");
  } finally {
    assert.equal(dirname(resolve(temporaryRoot)), tempParent);
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("Engram smoke failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
