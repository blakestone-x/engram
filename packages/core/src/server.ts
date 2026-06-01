/**
 * Local control-panel API. A dependency-free `node:http` server bound to
 * loopback that exposes the engine as JSON and (optionally) serves the built
 * panel SPA. No auth by design — it listens on 127.0.0.1 only.
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { runConsolidation } from "./consolidate.js";
import { decayReport, retentionFor, runDecay } from "./decay.js";
import { buildGraph } from "./graph.js";
import { recall } from "./recall.js";
import { buildIndex, search } from "./search.js";
import { vaultStats } from "./stats.js";
import { refreshStore } from "./store.js";
import { getMemory, listMemories, readRuns, reinforce } from "./vault.js";
import type { Tier, Vault } from "./types.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

interface ServerOptions {
  /** Directory of the built panel SPA. When set, non-API GETs serve it. */
  staticDir?: string;
}

export function createServer(vault: Vault, options: ServerOptions = {}) {
  return createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    const method = req.method ?? "GET";

    try {
      if (path.startsWith("/api/")) {
        refreshStore(vault.root); // reflect external edits made since the last request
        await handleApi(vault, req, res, method, path, url);
        return;
      }
      if (method === "GET" && options.staticDir) {
        serveStatic(options.staticDir, path, res);
        return;
      }
      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });
}

async function handleApi(
  vault: Vault,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  url: URL,
): Promise<void> {
  // GET /api/stats
  if (method === "GET" && path === "/api/stats") {
    return sendJson(res, 200, vaultStats(vault));
  }

  // GET /api/memories
  if (method === "GET" && path === "/api/memories") {
    const tier = url.searchParams.get("tier") as Tier | null;
    const type = url.searchParams.get("type");
    const status = url.searchParams.get("status");
    const q = url.searchParams.get("q")?.toLowerCase();
    const sort = url.searchParams.get("sort") ?? "retention";
    const limit = Number(url.searchParams.get("limit") ?? "500");
    let rows = listMemories(vault).map((m) => ({
      id: m.frontmatter.id,
      title: m.frontmatter.title,
      tier: m.frontmatter.tier,
      type: m.frontmatter.type,
      status: m.frontmatter.status,
      importance: m.frontmatter.importance,
      strength: m.frontmatter.strength,
      summary: m.frontmatter.summary,
      path: m.path,
      retention: retentionFor(m.frontmatter, vault.config.decay),
    }));
    if (tier) rows = rows.filter((r) => r.tier === tier);
    if (type) rows = rows.filter((r) => r.type === type);
    if (status) rows = rows.filter((r) => r.status === status);
    if (q) rows = rows.filter((r) => `${r.title} ${r.summary}`.toLowerCase().includes(q));
    rows.sort((a, b) => {
      if (sort === "strength") return b.strength - a.strength;
      if (sort === "importance") return b.importance - a.importance;
      if (sort === "title") return a.title.localeCompare(b.title);
      return a.retention - b.retention; // default: most-decayed first
    });
    return sendJson(res, 200, rows.slice(0, limit));
  }

  // GET /api/memories/:id
  const memMatch = path.match(/^\/api\/memories\/([^/]+)$/);
  if (method === "GET" && memMatch) {
    const memory = getMemory(vault, decodeURIComponent(memMatch[1] ?? ""));
    if (!memory) return sendJson(res, 404, { error: "memory not found" });
    const all = listMemories(vault);
    const resolveLink = (to: string) => all.find((m) => m.frontmatter.id === to || m.path === to);
    return sendJson(res, 200, {
      ...memory.frontmatter,
      body: memory.body,
      path: memory.path,
      retention: retentionFor(memory.frontmatter, vault.config.decay),
      links: memory.frontmatter.links.map((l) => ({
        ...l,
        title: resolveLink(l.to)?.frontmatter.title ?? l.to,
      })),
    });
  }

  // POST /api/memories/:id/reinforce
  const reinforceMatch = path.match(/^\/api\/memories\/([^/]+)\/reinforce$/);
  if (method === "POST" && reinforceMatch) {
    const [updated] = reinforce(vault, [decodeURIComponent(reinforceMatch[1] ?? "")], "panel");
    if (!updated) return sendJson(res, 404, { error: "memory not found" });
    return sendJson(res, 200, { ...updated.frontmatter, retention: retentionFor(updated.frontmatter, vault.config.decay) });
  }

  // GET /api/search
  if (method === "GET" && path === "/api/search") {
    const q = url.searchParams.get("q") ?? "";
    const tier = (url.searchParams.get("tier") as Tier | null) ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? "10");
    return sendJson(res, 200, search(vault, q, { tier, limit }));
  }

  // GET /api/recall
  if (method === "GET" && path === "/api/recall") {
    const q = url.searchParams.get("q") ?? "";
    const limit = Number(url.searchParams.get("limit") ?? "10");
    return sendJson(res, 200, recall(vault, q, { limit }));
  }

  // GET /api/graph
  if (method === "GET" && path === "/api/graph") {
    return sendJson(res, 200, buildGraph(vault));
  }

  // GET /api/decay
  if (method === "GET" && path === "/api/decay") {
    return sendJson(res, 200, decayReport(vault));
  }

  // GET /api/runs
  if (method === "GET" && path === "/api/runs") {
    const limit = Number(url.searchParams.get("limit") ?? "50");
    return sendJson(res, 200, readRuns(vault, limit));
  }

  // POST /api/ops/*
  if (method === "POST" && path === "/api/ops/decay") {
    const body = (await readBody(req)) as { apply?: boolean };
    return sendJson(res, 200, runDecay(vault, { apply: body.apply }));
  }
  if (method === "POST" && path === "/api/ops/consolidate") {
    const body = (await readBody(req)) as { apply?: boolean };
    return sendJson(res, 200, runConsolidation(vault, { apply: body.apply }));
  }
  if (method === "POST" && path === "/api/ops/reindex") {
    const index = buildIndex(vault, true);
    return sendJson(res, 200, { indexed: Object.keys(index.docs).length });
  }

  sendJson(res, 404, { error: `no route for ${method} ${path}` });
}

function serveStatic(staticDir: string, urlPath: string, res: ServerResponse): void {
  const rel = urlPath === "/" ? "index.html" : normalize(urlPath).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  let file = join(staticDir, rel);
  if (!existsSync(file) || !statSync(file).isFile()) {
    file = join(staticDir, "index.html"); // SPA fallback
  }
  if (!existsSync(file)) {
    sendJson(res, 404, { error: "panel build not found" });
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}
