/**
 * Minimal .env loader (no dependency). Reads `KEY=value` lines from a `.env`
 * file and sets them on `process.env` only when not already set, so an explicit
 * environment variable always wins. Used so an API key (e.g. OPENAI_API_KEY for
 * the optional embedding layer) can live in a gitignored `.env` rather than the
 * shell. Engram never reads or writes a `.env` unless a consumer calls this.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Load `.env` from each given directory (first value wins; existing env wins over all). */
export function loadEnv(...dirs: string[]): void {
  for (const dir of dirs) {
    const path = join(dir, ".env");
    if (!existsSync(path)) continue;
    let text: string;
    try {
      text = readFileSync(path, "utf8").replace(/^﻿/, "");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eq = trimmed.indexOf("=");
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}
