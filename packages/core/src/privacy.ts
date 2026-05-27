/** Privacy scrub: redact obvious secrets before a memory is written to disk. */

import type { EngramConfig } from "./types.js";

export interface ScrubResult {
  text: string;
  redactions: number;
}

/**
 * Replace anything matching the vault's `redactPatterns` with `[REDACTED]`.
 * Patterns are treated as case-sensitive regular expressions. Invalid patterns
 * are skipped rather than throwing, so a bad config line never blocks a write.
 */
export function scrub(text: string, config: EngramConfig): ScrubResult {
  let out = text;
  let redactions = 0;
  for (const pattern of config.redactPatterns) {
    let re: RegExp;
    try {
      re = new RegExp(pattern, "g");
    } catch {
      continue;
    }
    out = out.replace(re, () => {
      redactions += 1;
      return "[REDACTED]";
    });
  }
  return { text: out, redactions };
}
