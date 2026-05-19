import type { CSSProperties } from "react";

import { VoiceBadge, voiceColorFor } from "@/components/VoiceBadge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { AuditRecordBody } from "@roguemouse/schemas";

function truncateHash(hex: string): string {
  if (hex.length <= 12) return hex;
  return `${hex.slice(0, 8)}…${hex.slice(-4)}`;
}

function readString(value: unknown, key: string): string | null {
  if (value !== null && typeof value === "object" && key in value) {
    const v = (value as Record<string, unknown>)[key];
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

function summarizePayload(record: AuditRecordBody): string {
  switch (record.recordType) {
    case "anomaly:detected": {
      const sym = readString(record.payload.evidence, "symbol") ?? "?";
      return `${record.payload.anomalyType} · ${sym} · severity ${record.payload.severity}`;
    }
    case "risk_officer:reasoning":
    case "ops_engineer:reasoning":
    case "synthesizer:reasoning": {
      const text = record.payload.reasoning ?? "";
      return text.length > 180 ? `${text.slice(0, 180)}…` : text;
    }
    case "synthesizer:proposal":
      return record.payload.proposalText;
    case "synthesizer:refusal":
      return `${record.payload.reasonCode} · ${record.payload.reasoningText}`;
    case "tool:call":
      return `${record.payload.toolName}(…)`;
    case "tool:result":
      return `${record.payload.toolName} → ${record.payload.durationMs}ms`;
    case "smoke_test:chat_completion": {
      const r = record.payload.response;
      return r.length > 180 ? `${r.slice(0, 180)}…` : r;
    }
    case "human:approval":
      return record.payload.notes ?? `approved by ${record.payload.approvedBy}`;
    case "human:rejection":
      return record.payload.reasonCode;
    case "final:committed":
      return `${record.payload.committedActions.length} action(s) committed via ${record.payload.brokerMockId}`;
    default:
      return "";
  }
}

export function RecordCard({
  record,
  ordinal,
  currentHash,
  hidden,
}: {
  record: AuditRecordBody;
  ordinal: number;
  currentHash: string;
  hidden?: boolean;
}) {
  const borderColor = voiceColorFor(record.recordType);
  const style: CSSProperties = {
    borderLeft: `4px solid ${borderColor}`,
    visibility: hidden ? "hidden" : undefined,
  };

  return (
    <Card style={style} className="bg-card">
      <CardHeader className="flex flex-row items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <span
            className="mono text-small w-7 text-right"
            style={{ color: "var(--color-muted)" }}
          >
            {String(ordinal).padStart(2, "0")}
          </span>
          <VoiceBadge recordType={record.recordType} />
        </div>
        <span className="mono text-caption" style={{ color: "var(--color-muted)" }}>
          {record.ts}
        </span>
      </CardHeader>

      <CardContent className="px-4 pb-4 pt-0 space-y-3">
        <p className="text-body" style={{ color: "var(--color-ink)" }}>
          {summarizePayload(record)}
        </p>

        <Collapsible>
          <CollapsibleTrigger
            className="text-label inline-flex items-center gap-2 hover:opacity-80 transition-opacity"
            style={{ color: "var(--color-muted)" }}
          >
            <span aria-hidden>›</span> show payload
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre
              className="mono text-small whitespace-pre-wrap mt-2 p-3 border"
              style={{
                backgroundColor: "var(--color-faint)",
                borderColor: "var(--color-rule)",
                color: "var(--color-ink)",
              }}
            >
              {JSON.stringify(record.payload, null, 2)}
            </pre>
          </CollapsibleContent>
        </Collapsible>

        <div
          className="mono text-caption flex flex-wrap gap-x-4 gap-y-1 pt-2 border-t"
          style={{ color: "var(--color-muted)", borderColor: "var(--color-rule)" }}
        >
          <span>prev {truncateHash(record.previousHash)}</span>
          <span>this {truncateHash(currentHash)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
