import { z } from "zod";

import { canonicalSafeSchema } from "../canonicalSafe.js";
import { defineTool } from "./defineTool.js";

/**
 * policy:check — verify whether a proposed action satisfies project
 * policies.
 *
 * The `action.details` field is typed as a canonicalization-safe
 * value at the schema layer — its specific shape varies by
 * `action.type` and is not narrowed in Sprint 3. Sprint 4+ may
 * introduce a discriminated union over `action.type` if the action
 * inventory stabilizes.
 */
export const policyCheckArgsSchema = z
  .object({
    action: z
      .object({
        type: z.string().min(1),
        details: canonicalSafeSchema,
      })
      .strict(),
  })
  .strict();

export type PolicyCheckArgs = z.infer<typeof policyCheckArgsSchema>;

/**
 * One policy violation: which policy was violated and a free-text
 * reason explaining why.
 */
const policyViolationSchema = z
  .object({
    policyName: z.string().min(1),
    reason: z.string(),
  })
  .strict();

export const policyCheckResultDataSchema = z
  .object({
    allowed: z.boolean(),
    violations: z.array(policyViolationSchema),
  })
  .strict();

export type PolicyCheckResultData = z.infer<
  typeof policyCheckResultDataSchema
>;

export const policyCheckTool = defineTool(
  "policy:check",
  policyCheckArgsSchema,
  policyCheckResultDataSchema,
);
