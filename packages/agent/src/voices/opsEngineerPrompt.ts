import type { DataFor, ToolResult } from "@roguemouse/schemas";

import type { Anomaly } from "../anomaly.js";

/**
 * Pure function. Builds the user prompt for the Ops Engineer voice
 * from the anomaly + the three upstream tool results
 * (position:snapshot, broker:reconcile, audit:search).
 *
 * Same purity discipline as buildRiskOfficerUserPrompt: tool errors
 * embedded in context, no dispatcher imports, no side effects.
 */
export function buildOpsEngineerUserPrompt(
  anomaly: Anomaly,
  positionSnapshot: ToolResult<DataFor<"position:snapshot">>,
  brokerReconcile: ToolResult<DataFor<"broker:reconcile">>,
  auditSearch: ToolResult<DataFor<"audit:search">>,
): string {
  const lines: string[] = [];

  lines.push(`ANOMALY DETECTED:`);
  lines.push(`  type: ${anomaly.anomalyType}`);
  lines.push(`  symbol: ${anomaly.symbol}`);
  lines.push(`  severity: ${anomaly.severity}/100`);
  lines.push(
    `  observed IV/RV ratio: ${(anomaly.observedRatioBp / 10000).toFixed(4)} (threshold: ${(anomaly.thresholdBp / 10000).toFixed(4)})`,
  );
  lines.push(`  detected at: ${anomaly.detectedAt}`);
  lines.push(``);

  lines.push(`POSITION SNAPSHOT (tool: position:snapshot):`);
  if (positionSnapshot.ok) {
    if (positionSnapshot.data.positions.length === 0) {
      lines.push(`  (no positions reported)`);
    } else {
      positionSnapshot.data.positions.forEach((p) => {
        lines.push(
          `  - strategy=${p.strategy} symbol=${p.symbol} qty=${p.quantity} avgEntry=${p.avgEntryPrice} current=${p.currentPrice} asOf=${p.asOf}`,
        );
      });
    }
  } else {
    lines.push(
      `  ERROR: code=${positionSnapshot.error.code} message=${positionSnapshot.error.message}`,
    );
  }
  lines.push(``);

  lines.push(`BROKER RECONCILIATION (tool: broker:reconcile, strategy=iv-rv-monitor):`);
  if (brokerReconcile.ok) {
    if (brokerReconcile.data.brokerPositions.length === 0) {
      lines.push(`  (broker reported no positions for this strategy)`);
    } else {
      brokerReconcile.data.brokerPositions.forEach((b) => {
        lines.push(
          `  - symbol=${b.symbol} brokerQty=${b.quantity} brokerAcct=${b.brokerAccountId} asOf=${b.asOf}`,
        );
      });
    }
  } else {
    lines.push(
      `  ERROR: code=${brokerReconcile.error.code} message=${brokerReconcile.error.message}`,
    );
  }
  lines.push(``);

  lines.push(`HISTORICAL AUDIT SEARCH (tool: audit:search, recordType=anomaly:detected):`);
  if (auditSearch.ok) {
    if (auditSearch.data.records.length === 0) {
      lines.push(`  (no prior anomaly:detected records found in audit log)`);
    } else {
      lines.push(
        `  ${auditSearch.data.records.length} prior anomaly record(s) found:`,
      );
      auditSearch.data.records.forEach((r, i) => {
        lines.push(
          `  ${i + 1}. ts=${r.ts} runId=${r.runId} recordType=${r.recordType}`,
        );
      });
      if (auditSearch.data.hasMore) {
        lines.push(`  (more records exist beyond this page; result is partial)`);
      }
    }
  } else {
    lines.push(
      `  ERROR: code=${auditSearch.error.code} message=${auditSearch.error.message}`,
    );
  }
  lines.push(``);

  lines.push(
    `Reason about operational integrity. Compare internal positions against the broker's view; flag any divergence with specific numbers. Note whether the historical record suggests this anomaly is novel or recurring. If operational signals conflict or data is missing, say so. Advise on whether a recommendation to a human operator is warranted.`,
  );

  return lines.join("\n");
}
