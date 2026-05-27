/**
 * Tokenizer shared by the search index and the consolidation clusterer.
 * Keeping a single tokenizer means "similar enough to cluster" and "matches the
 * query" use the same notion of a word.
 */

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "onto", "over",
  "are", "was", "were", "has", "have", "had", "not", "but", "you", "your",
  "its", "it's", "they", "them", "their", "what", "when", "which", "who",
  "will", "would", "could", "should", "can", "did", "does", "done", "also",
  "than", "then", "there", "here", "about", "after", "before", "between",
  "session", "summary", "tool", "note", "memory",
]);

/** Lowercase alnum tokens of length >= 3, minus stopwords. */
export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g);
  if (!matches) return [];
  return matches.filter((t) => !STOPWORDS.has(t));
}

/** A bounded token *set* for similarity work (order-free, capped). */
export function tokenSet(text: string, cap = 80): Set<string> {
  return new Set(tokenize(text).slice(0, cap));
}

/** Jaccard similarity between two token sets. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Term-frequency map for BM25 indexing. */
export function termFrequencies(text: string): Record<string, number> {
  const tf: Record<string, number> = {};
  for (const t of tokenize(text)) tf[t] = (tf[t] ?? 0) + 1;
  return tf;
}
