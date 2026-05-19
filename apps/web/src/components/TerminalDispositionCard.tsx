import type { CSSProperties } from "react";

import { VoiceBadge } from "@/components/VoiceBadge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { AuditRecordBody } from "@roguemouse/schemas";

type Disposition = {
  accent: string;
  accentDim: string;
  accentBorder: string;
  body: string;
  confidenceBp: number | null;
};

function dispositionFor(record: AuditRecordBody): Disposition | null {
  switch (record.recordType) {
    case "synthesizer:proposal":
      return {
        accent: "var(--color-positive)",
        accentDim: "var(--color-positive-dim)",
        accentBorder: "var(--color-positive-border)",
        body: record.payload.proposalText,
        confidenceBp: record.payload.confidence,
      };
    case "synthesizer:refusal":
      return {
        accent: "var(--color-caution)",
        accentDim: "var(--color-caution-dim)",
        accentBorder: "var(--color-caution-border)",
        body: record.payload.reasoningText,
        confidenceBp: null,
      };
    case "human:approval":
      return {
        accent: "var(--color-positive)",
        accentDim: "var(--color-positive-dim)",
        accentBorder: "var(--color-positive-border)",
        body: record.payload.notes ?? `approved by ${record.payload.approvedBy}`,
        confidenceBp: null,
      };
    case "human:rejection":
      return {
        accent: "var(--color-caution)",
        accentDim: "var(--color-caution-dim)",
        accentBorder: "var(--color-caution-border)",
        body: record.payload.notes ?? record.payload.reasonCode,
        confidenceBp: null,
      };
    case "final:committed":
      return {
        accent: "var(--color-positive)",
        accentDim: "var(--color-positive-dim)",
        accentBorder: "var(--color-positive-border)",
        body: `${record.payload.committedActions.length} action(s) committed via ${record.payload.brokerMockId}`,
        confidenceBp: null,
      };
    default:
      return null;
  }
}

export function TerminalDispositionCard({
  record,
  elapsedSeconds,
}: {
  record: AuditRecordBody;
  elapsedSeconds: number | null;
}) {
  const disposition = dispositionFor(record);
  if (disposition === null) return null;

  const cardStyle: CSSProperties = {
    borderLeft: `4px solid ${disposition.accent}`,
    backgroundImage: `linear-gradient(to right, ${disposition.accentDim}, var(--color-surface) 65%)`,
    borderColor: disposition.accentBorder,
  };

  return (
    <Card style={cardStyle}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 p-4 pb-2">
        <div className="space-y-1.5">
          <p className="text-label" style={{ color: disposition.accent }}>
            Terminal disposition
          </p>
          <VoiceBadge recordType={record.recordType} />
        </div>
        <p
          className="mono text-caption text-right"
          style={{ color: "var(--color-muted)" }}
        >
          {disposition.confidenceBp !== null ? (
            <>
              confidence {(disposition.confidenceBp / 100).toFixed(0)}%
              {elapsedSeconds !== null ? <br /> : null}
            </>
          ) : null}
          {elapsedSeconds !== null
            ? `elapsed ${elapsedSeconds.toFixed(1)}s`
            : null}
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-2">
        <p
          className="text-body line-clamp-3"
          style={{ color: "var(--color-ink)" }}
        >
          {disposition.body}
        </p>
      </CardContent>
    </Card>
  );
}
