import { z } from "zod";

import { defineTool } from "./defineTool.js";

/**
 * Args for `runbook:search`. Used by the planner to fetch relevant
 * runbook chunks for an anomaly context.
 *
 *  - `query`: free-text search query (non-empty).
 *  - `topK`: number of results to return, bounded 1 to 10. The upper
 *    bound prevents the planner from over-pulling the runbook corpus
 *    into a single prompt.
 */
export const runbookSearchArgsSchema = z
  .object({
    query: z.string().min(1),
    topK: z.number().int().min(1).max(10),
  })
  .strict();

export type RunbookSearchArgs = z.infer<typeof runbookSearchArgsSchema>;

/**
 * One runbook match: a path identifier, an excerpt string, and an
 * integer relevance score in basis points (0 to 10000 = 0% to 100%
 * confidence in 0.01% steps).
 */
const runbookMatchSchema = z
  .object({
    path: z.string().min(1),
    excerpt: z.string(),
    relevanceScore: z.number().int().min(0).max(10000),
  })
  .strict();

export const runbookSearchResultDataSchema = z
  .object({
    matches: z.array(runbookMatchSchema),
  })
  .strict();

export type RunbookSearchResultData = z.infer<
  typeof runbookSearchResultDataSchema
>;

export const runbookSearchTool = defineTool(
  "runbook:search",
  runbookSearchArgsSchema,
  runbookSearchResultDataSchema,
);
