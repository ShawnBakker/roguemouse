import type { Anomaly } from "../anomaly.js";

/**
 * Pure function. Builds the user prompt for the Synthesizer voice
 * from the anomaly + the prior reasoning strings of the Risk Officer
 * and Ops Engineer voices.
 *
 * The system prompt (SYNTHESIZER_SYSTEM_PROMPT) already describes
 * the required JSON response schema. The user prompt provides the
 * inputs to reconcile.
 *
 * Same purity discipline as the other prompt builders. No dispatcher
 * imports; no tool calls.
 */
export function buildSynthesizerUserPrompt(
  anomaly: Anomaly,
  riskOfficerReasoning: string,
  opsEngineerReasoning: string,
): string {
  const lines: string[] = [];

  lines.push(`ANOMALY UNDER REVIEW:`);
  lines.push(`  type: ${anomaly.anomalyType}`);
  lines.push(`  symbol: ${anomaly.symbol}`);
  lines.push(`  severity: ${anomaly.severity}/100`);
  lines.push(
    `  observed IV/RV ratio: ${(anomaly.observedRatioBp / 10000).toFixed(4)} (threshold: ${(anomaly.thresholdBp / 10000).toFixed(4)})`,
  );
  lines.push(`  detected at: ${anomaly.detectedAt}`);
  lines.push(``);

  lines.push(`RISK OFFICER REASONING:`);
  lines.push(riskOfficerReasoning.trim());
  lines.push(``);

  lines.push(`OPERATIONS ENGINEER REASONING:`);
  lines.push(opsEngineerReasoning.trim());
  lines.push(``);

  lines.push(
    `Reconcile the two perspectives above. Decide whether to recommend an action (decision = "proposal") or to refuse and explain why (decision = "refusal"). Output JSON matching exactly the schema described in your system prompt. Confidence below 4500 bp must produce a refusal; substantial disagreement between voices or degraded inputs should also produce a refusal. If you propose, the proposal_text must be phrased as a recommendation TO a human operator, not an imperative.`,
  );

  return lines.join("\n");
}
