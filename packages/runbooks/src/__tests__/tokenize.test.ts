import { describe, expect, it } from "vitest";

import { STOPWORDS } from "../stopwords.js";
import { tokenize } from "../tokenize.js";

describe("STOPWORDS", () => {
  it("contains exactly the 20 locked stopwords", () => {
    expect(STOPWORDS.size).toBe(20);
    for (const word of [
      "the", "a", "an", "is", "are", "of", "to", "for",
      "in", "on", "at", "by", "with", "and", "or", "not",
      "this", "that", "these", "those",
    ]) {
      expect(STOPWORDS.has(word)).toBe(true);
    }
  });
});

describe("tokenize", () => {
  it("returns empty array for empty input", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("returns empty array when input is all stopwords", () => {
    expect(tokenize("of the and or not")).toEqual([]);
  });

  it("lowercases tokens", () => {
    expect(tokenize("IV RV Ratio")).toEqual(["iv", "rv", "ratio"]);
  });

  it("filters stopwords during tokenization", () => {
    expect(tokenize("the ratio is high")).toEqual(["ratio", "high"]);
  });

  it("splits on whitespace and locked punctuation set", () => {
    expect(tokenize("IV/RV, ratio: high; (anomaly) detected?!")).toEqual([
      "iv/rv",
      "ratio",
      "high",
      "anomaly",
      "detected",
    ]);
  });

  it("preserves hyphens within tokens", () => {
    expect(tokenize("low-bound threshold")).toEqual(["low-bound", "threshold"]);
  });

  it("collapses runs of whitespace", () => {
    expect(tokenize("  multiple    spaces  here  ")).toEqual([
      "multiple",
      "spaces",
      "here",
    ]);
  });

  it("strips double and single quotes", () => {
    expect(tokenize(`"quoted" and 'apostrophe' words`)).toEqual([
      "quoted",
      "apostrophe",
      "words",
    ]);
  });
});
