import { describe, expect, it } from "vitest";

import { runbookSearch } from "../runbookSearch.js";
import { makeCtx } from "./testHelpers.js";

describe("runbookSearch", () => {
  it("returns matches for a query that hits the index", async () => {
    const result = await runbookSearch(
      { query: "iv rv divergence", topK: 3 },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.matches.length).toBeGreaterThan(0);
      expect(result.data.matches[0]?.path).toContain("iv-rv");
    }
  });

  it("returns an empty matches array for a query with no hits", async () => {
    const result = await runbookSearch(
      { query: "nonexistent-token", topK: 3 },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.matches).toEqual([]);
    }
  });

  it("respects topK", async () => {
    const result = await runbookSearch(
      { query: "iv rv audit chain integrity", topK: 1 },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.matches.length).toBeLessThanOrEqual(1);
    }
  });
});
