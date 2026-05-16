import { z } from "zod";

import { ISO_TIMESTAMP_MS_REGEX } from "../primitives.js";
import { defineTool } from "./defineTool.js";

/**
 * Args for `position:snapshot`. Both fields are optional; an absent
 * field means "no filter on this dimension" (the snapshot returns
 * all positions matching any non-absent filter).
 */
export const positionSnapshotArgsSchema = z
  .object({
    strategy: z.string().min(1).optional(),
    symbol: z.string().min(1).optional(),
  })
  .strict();

export type PositionSnapshotArgs = z.infer<typeof positionSnapshotArgsSchema>;

/**
 * One position record. `quantity` is a signed integer (positive =
 * long, negative = short, zero = flat). Prices are integer cents.
 * `asOf` is ISO-8601 UTC at millisecond precision.
 */
const positionSchema = z
  .object({
    strategy: z.string().min(1),
    symbol: z.string().min(1),
    quantity: z.number().int(),
    avgEntryPrice: z.number().int().nonnegative(),
    currentPrice: z.number().int().nonnegative(),
    asOf: z.string().regex(ISO_TIMESTAMP_MS_REGEX),
  })
  .strict();

export const positionSnapshotResultDataSchema = z
  .object({
    positions: z.array(positionSchema),
  })
  .strict();

export type PositionSnapshotResultData = z.infer<
  typeof positionSnapshotResultDataSchema
>;

export const positionSnapshotTool = defineTool(
  "position:snapshot",
  positionSnapshotArgsSchema,
  positionSnapshotResultDataSchema,
);
