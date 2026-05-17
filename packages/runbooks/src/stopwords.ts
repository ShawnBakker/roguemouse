/**
 * Locked 20-word stopword list for runbook-corpus tokenization
 * (spec AC-26). Applied to both indexed documents and search queries.
 *
 * Changing this list invalidates Sprint 4b's ranking behavior. Do
 * not edit without a corresponding spec amendment.
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "of",
  "to",
  "for",
  "in",
  "on",
  "at",
  "by",
  "with",
  "and",
  "or",
  "not",
  "this",
  "that",
  "these",
  "those",
]);
