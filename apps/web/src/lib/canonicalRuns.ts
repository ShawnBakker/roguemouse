export const CANONICAL_RUNS = {
  clean: {
    runId: "cfbafd8c-47f9-4dbc-8c5a-dc55a6b08577",
    recordCount: 15,
    decision: "proposal" as const,
    confidenceBp: 9000,
    totalElapsedMs: 33300,
  },
  degraded: {
    runId: "381dd171-68d4-427a-af59-b4af704768b9",
    recordCount: 15,
    decision: "proposal" as const,
    confidenceBp: 9200,
    totalElapsedMs: 30600,
  },
} as const;

export type Variant = keyof typeof CANONICAL_RUNS;

export function isVariant(value: unknown): value is Variant {
  return value === "clean" || value === "degraded";
}
