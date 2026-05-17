import { describe, expect, it } from "vitest";

import type { LoadedRunbook } from "../loader.js";
import {
  buildSearchIndex,
  searchRunbookIndex,
  type RunbookIndex,
} from "../searchIndex.js";

function makeLoaded(
  filename: string,
  body: string,
  excerpt = "stub excerpt",
): LoadedRunbook {
  return { path: filename, rawContent: body, excerpt };
}

describe("buildSearchIndex", () => {
  it("indexes a single document with frequencies", () => {
    const corpus = [makeLoaded("a.md", "alpha beta alpha gamma")];
    const index = buildSearchIndex(corpus);
    expect(index.docs).toHaveLength(1);
    const doc = index.docs[0]!;
    expect(doc.totalTokens).toBe(4);
    expect(doc.freq.get("alpha")).toBe(2);
    expect(doc.freq.get("beta")).toBe(1);
    expect(doc.freq.get("gamma")).toBe(1);
  });

  it("throws when a document has zero indexable tokens after stopword filtering", () => {
    const corpus = [makeLoaded("empty.md", "the of and to")];
    expect(() => buildSearchIndex(corpus)).toThrow(
      /zero indexable tokens/,
    );
  });
});

describe("searchRunbookIndex", () => {
  function fixtureIndex(): RunbookIndex {
    return buildSearchIndex([
      makeLoaded(
        "iv-rv.md",
        "iv rv ratio divergence threshold breach low-bound iv rv anomaly",
      ),
      makeLoaded(
        "circuit.md",
        "circuit breaker tripped retries exceeded threshold",
      ),
      makeLoaded("audit.md", "audit chain integrity hash verification"),
    ]);
  }

  it("returns empty array for empty query", () => {
    expect(searchRunbookIndex(fixtureIndex(), "", 3)).toEqual([]);
  });

  it("returns empty array when query is only stopwords", () => {
    expect(searchRunbookIndex(fixtureIndex(), "the of and to", 3)).toEqual([]);
  });

  it("returns empty array for topK=0", () => {
    expect(searchRunbookIndex(fixtureIndex(), "iv rv", 0)).toEqual([]);
  });

  it("returns matches ordered by descending relevance", () => {
    const idx = fixtureIndex();
    const results = searchRunbookIndex(idx, "iv rv", 3);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.path).toBe("iv-rv.md");
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.relevanceScore).toBeGreaterThanOrEqual(
        results[i]!.relevanceScore,
      );
    }
  });

  it("respects topK limit", () => {
    const idx = fixtureIndex();
    const results = searchRunbookIndex(idx, "threshold", 1);
    expect(results).toHaveLength(1);
  });

  it("returns empty array when no document contains query tokens", () => {
    const idx = fixtureIndex();
    expect(searchRunbookIndex(idx, "nonexistent-token", 3)).toEqual([]);
  });

  it("uses stable insertion-order tie-break for equal scores", () => {
    const corpus = [
      makeLoaded("a.md", "alpha beta"),
      makeLoaded("b.md", "alpha beta"),
      makeLoaded("c.md", "alpha beta"),
    ];
    const idx = buildSearchIndex(corpus);
    const results = searchRunbookIndex(idx, "alpha", 3);
    expect(results.map((r) => r.path)).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("reports relevanceScore as an integer in basis points 0-10000", () => {
    const idx = fixtureIndex();
    const results = searchRunbookIndex(idx, "iv rv ratio", 3);
    for (const r of results) {
      expect(Number.isInteger(r.relevanceScore)).toBe(true);
      expect(r.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(r.relevanceScore).toBeLessThanOrEqual(10000);
    }
  });

  it("passes through the precomputed excerpt unchanged", () => {
    const corpus = [
      makeLoaded("a.md", "alpha beta", "this is the precomputed excerpt"),
    ];
    const idx = buildSearchIndex(corpus);
    const [match] = searchRunbookIndex(idx, "alpha", 1);
    expect(match?.excerpt).toBe("this is the precomputed excerpt");
  });
});
