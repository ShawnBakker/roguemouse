import { z } from "zod";

import { ISO_TIMESTAMP_MS_REGEX } from "../primitives.js";
import { defineTool } from "./defineTool.js";

/**
 * Args for `market_data:lookup`. The tool returns a current market
 * snapshot for one symbol.
 */
export const marketDataLookupArgsSchema = z
  .object({
    symbol: z.string().min(1),
  })
  .strict();

export type MarketDataLookupArgs = z.infer<typeof marketDataLookupArgsSchema>;

/**
 * Result data for `market_data:lookup`.
 *
 * Unit conventions (per spec Data flow):
 *  - `spotPrice`: integer cents. `$123.45` is `12345`.
 *  - `impliedVolatility` / `realizedVolatility`: integer basis points
 *    of a percentage point. `23.5%` is `2350`. Range 0 to 10000.
 *  - `surfaceTs`: ISO-8601 UTC at millisecond precision.
 *
 * All numeric values are integers within JavaScript's safe-integer
 * range to satisfy the canonicalization constraint. No floats anywhere.
 */
export const marketDataLookupResultDataSchema = z
  .object({
    spotPrice: z.number().int().nonnegative(),
    impliedVolatility: z.number().int().min(0).max(10000),
    realizedVolatility: z.number().int().min(0).max(10000),
    surfaceTs: z.string().regex(ISO_TIMESTAMP_MS_REGEX),
  })
  .strict();

export type MarketDataLookupResultData = z.infer<
  typeof marketDataLookupResultDataSchema
>;

export const marketDataLookupTool = defineTool(
  "market_data:lookup",
  marketDataLookupArgsSchema,
  marketDataLookupResultDataSchema,
);
