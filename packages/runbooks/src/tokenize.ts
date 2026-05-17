import { STOPWORDS } from "./stopwords.js";

const SPLIT_REGEX = /[\s,.\:;()?!"']+/;

/**
 * Tokenize an input string for the runbook keyword index (spec AC-26).
 *
 *  - lowercases input
 *  - splits on whitespace + locked punctuation set
 *    (comma, period, colon, semicolon, parens, question, exclamation,
 *     double-quote, single-quote)
 *  - preserves hyphens (so "low-bound" stays as one token)
 *  - filters empty strings and stopwords
 */
export function tokenize(input: string): string[] {
  const lowered = input.toLowerCase();
  const parts = lowered.split(SPLIT_REGEX);
  const result: string[] = [];
  for (const part of parts) {
    if (part.length === 0) continue;
    if (STOPWORDS.has(part)) continue;
    result.push(part);
  }
  return result;
}
