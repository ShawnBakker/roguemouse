import type { DataFor, ToolResult } from "@roguemouse/schemas";

import type { Anomaly } from "../anomaly.js";

/**
 * Pure function. Builds the user prompt for the Risk Officer voice
 * from the anomaly + the two upstream tool results.
 *
 * Tool errors are NOT thrown — they're embedded in the prompt context
 * per AC-36 ("the voice's user prompt builder should include 'the
 * system tried to fetch X but got error Y' in the prompt"). The LLM
 * reasons over partial information when tools fail.
 *
 * No dispatcher imports; no tool calls; no side effects.
 */
export function buildRiskOfficerUserPrompt(
  anomaly: Anomaly,
  marketData: ToolResult<DataFor<"market_data:lookup">>,
  runbookSearch: ToolResult<DataFor<"runbook:search">>,
): string {
  const lines: string[] = [];

  lines.push(`ANOMALY DETECTED:`);
  lines.push(`  type: ${anomaly.anomalyType}`);
  lines.push(`  symbol: ${anomaly.symbol}`);
  lines.push(`  severity: ${anomaly.severity}/100`);
  lines.push(
    `  observed IV/RV ratio: ${(anomaly.observedRatioBp / 10000).toFixed(4)} (threshold: ${(anomaly.thresholdBp / 10000).toFixed(4)})`,
  );
  lines.push(`  surface timestamp: ${anomaly.surfaceTs}`);
  lines.push(`  detected at: ${anomaly.detectedAt}`);
  lines.push(``);

  lines.push(`MARKET DATA LOOKUP (tool: market_data:lookup):`);
  if (marketData.ok) {
    lines.push(`  spotPrice: ${marketData.data.spotPrice} (integer cents)`);
    lines.push(
      `  impliedVolatility: ${marketData.data.impliedVolatility} bp`,
    );
    lines.push(
      `  realizedVolatility: ${marketData.data.realizedVolatility} bp`,
    );
    lines.push(`  surfaceTs: ${marketData.data.surfaceTs}`);
  } else {
    lines.push(
      `  ERROR: code=${marketData.error.code} message=${marketData.error.message}`,
    );
    lines.push(`  (the system attempted this lookup but it failed; reason above)`);
  }
  lines.push(``);

  lines.push(`RUNBOOK SEARCH (tool: runbook:search):`);
  if (runbookSearch.ok) {
    if (runbookSearch.data.matches.length === 0) {
      lines.push(`  (no runbook matches returned)`);
    } else {
      runbookSearch.data.matches.forEach((m, i) => {
        lines.push(
          `  ${i + 1}. ${m.path} (relevance ${m.relevanceScore} bp)`,
        );
        lines.push(`     excerpt: ${m.excerpt}`);
      });
    }
  } else {
    lines.push(
      `  ERROR: code=${runbookSearch.error.code} message=${runbookSearch.error.message}`,
    );
  }
  lines.push(``);

  lines.push(
    `Reason about the exposure risk implied by this anomaly. Be specific about which inputs informed your reasoning. If the data is degraded or sparse, say so explicitly. Advise on whether a recommendation to a human operator is warranted, or whether more information is needed.`,
  );

  return lines.join("\n");
}
