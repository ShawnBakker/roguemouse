import { z } from "zod";

import { ISO_TIMESTAMP_MS_REGEX } from "../primitives.js";
import { defineTool } from "./defineTool.js";

/**
 * Args for `broker:reconcile`. Looks up broker-reported positions for
 * a strategy, used to detect divergence between the platform's
 * internal position state and what the broker says.
 */
export const brokerReconcileArgsSchema = z
  .object({
    strategy: z.string().min(1),
  })
  .strict();

export type BrokerReconcileArgs = z.infer<typeof brokerReconcileArgsSchema>;

/**
 * One broker-side position. Same `quantity` / `asOf` conventions as
 * `position:snapshot` (signed integer / ISO ms). `brokerAccountId` is
 * the broker's account identifier; the demo's broker mock uses a fixed
 * deterministic value.
 */
const brokerPositionSchema = z
  .object({
    symbol: z.string().min(1),
    quantity: z.number().int(),
    brokerAccountId: z.string().min(1),
    asOf: z.string().regex(ISO_TIMESTAMP_MS_REGEX),
  })
  .strict();

export const brokerReconcileResultDataSchema = z
  .object({
    brokerPositions: z.array(brokerPositionSchema),
  })
  .strict();

export type BrokerReconcileResultData = z.infer<
  typeof brokerReconcileResultDataSchema
>;

export const brokerReconcileTool = defineTool(
  "broker:reconcile",
  brokerReconcileArgsSchema,
  brokerReconcileResultDataSchema,
);
