/**
 * Namespacing for multi-agent memory.
 *
 * Every multi-agent framework converged on the same model: a memory layer keyed
 * by a scope (user / agent / project), default-isolated with an opt-in global
 * tier, so concurrent agents don't contaminate each other. Engram expresses this
 * with three optional frontmatter fields — `scope` (the namespace), `author` (who
 * wrote it, for provenance and audit), and `visibility` — and a filter at recall.
 *
 * Back-compat: a memory with no `scope` is treated as visible everywhere, so
 * existing single-agent vaults are unaffected.
 */

import type { Frontmatter } from "./types.js";

/**
 * Is a memory visible when recalling within `scope`?
 * - no scope requested → everything is visible
 * - unscoped memory → visible everywhere (legacy / shared knowledge)
 * - scoped memory → visible only in its own scope, unless marked `global`
 */
export function inScope(fm: Pick<Frontmatter, "scope" | "visibility">, scope?: string): boolean {
  if (!scope) return true;
  if (!fm.scope) return true;
  return fm.scope === scope || fm.visibility === "global";
}
