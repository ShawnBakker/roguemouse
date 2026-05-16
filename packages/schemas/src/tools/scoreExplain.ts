import { z } from "zod";

import { defineTool } from "./defineTool.js";

/**
 * Args for `score:explain`. The planner passes a strategy name and a
 * composite score value; the tool returns the score's components.
 *
 *  - `scoreValue`: integer in the closed range -100 to +100 (the
 *    project's score scale).
 */
export const scoreExplainArgsSchema = z
  .object({
    strategy: z.string().min(1),
    scoreValue: z.number().int().min(-100).max(100),
  })
  .strict();

export type ScoreExplainArgs = z.infer<typeof scoreExplainArgsSchema>;

/**
 * One score component.
 *
 *  - `contribution`: signed integer, in the same unit as the score
 *    itself (no explicit range constraint; can be negative).
 *  - `weight`: integer basis points 0 to 10000 (component's weight
 *    relative to the full score).
 */
const scoreComponentSchema = z
  .object({
    name: z.string().min(1),
    contribution: z.number().int(),
    weight: z.number().int().min(0).max(10000),
  })
  .strict();

export const scoreExplainResultDataSchema = z
  .object({
    components: z.array(scoreComponentSchema),
    narrative: z.string(),
  })
  .strict();

export type ScoreExplainResultData = z.infer<
  typeof scoreExplainResultDataSchema
>;

export const scoreExplainTool = defineTool(
  "score:explain",
  scoreExplainArgsSchema,
  scoreExplainResultDataSchema,
);
