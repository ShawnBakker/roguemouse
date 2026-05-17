import type { LoadedRunbook } from "./loader.js";
import { tokenize } from "./tokenize.js";

export type RunbookDoc = {
  path: string;
  excerpt: string;
  totalTokens: number;
  freq: Map<string, number>;
};

export type RunbookIndex = {
  docs: RunbookDoc[];
};

export type RunbookMatch = {
  path: string;
  excerpt: string;
  relevanceScore: number;
};

function clampRelevance(score: number): number {
  const scaled = Math.round(score * 10000);
  if (scaled < 0) return 0;
  if (scaled > 10000) return 10000;
  return scaled;
}

/**
 * Build an in-memory frequency-based keyword index over the runbook
 * corpus. Tokens are extracted from each runbook's full raw content
 * (not just the excerpt) using the same tokenizer + stopword filter
 * applied to queries at search time.
 *
 * Throws if any runbook indexes to zero tokens after filtering
 * (defensive — corpus quality invariant).
 */
export function buildSearchIndex(corpus: LoadedRunbook[]): RunbookIndex {
  const docs: RunbookDoc[] = [];
  for (const rb of corpus) {
    const tokens = tokenize(rb.rawContent);
    if (tokens.length === 0) {
      throw new Error(
        `Runbook has zero indexable tokens after stopword filtering: ${rb.path}`,
      );
    }
    const freq = new Map<string, number>();
    for (const t of tokens) {
      freq.set(t, (freq.get(t) ?? 0) + 1);
    }
    docs.push({
      path: rb.path,
      excerpt: rb.excerpt,
      totalTokens: tokens.length,
      freq,
    });
  }
  return { docs };
}

/**
 * Search the index for the top-K runbooks matching the query.
 * Frequency score: sum over query tokens of (token freq in doc /
 * doc total tokens). Stable insertion-order tie-break (Array.sort
 * is stable in modern JS engines).
 *
 * `relevanceScore` is reported in basis points (0-10000), clamped.
 * An empty query (or query consisting only of stopwords) returns
 * an empty array.
 */
export function searchRunbookIndex(
  index: RunbookIndex,
  query: string,
  topK: number,
): RunbookMatch[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];
  if (topK <= 0) return [];

  const scored: Array<{
    doc: RunbookDoc;
    score: number;
    insertion: number;
  }> = [];
  for (let i = 0; i < index.docs.length; i++) {
    const doc = index.docs[i];
    if (!doc) continue;
    let score = 0;
    for (const qt of queryTokens) {
      const f = doc.freq.get(qt);
      if (f !== undefined) {
        score += f / doc.totalTokens;
      }
    }
    if (score > 0) {
      scored.push({ doc, score, insertion: i });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.insertion - b.insertion;
  });

  const top = scored.slice(0, topK);
  return top.map((s) => ({
    path: s.doc.path,
    excerpt: s.doc.excerpt,
    relevanceScore: clampRelevance(s.score),
  }));
}
