import type { CSSProperties } from "react";
import { Badge } from "@/components/ui/badge";
import type { RecordTypeName } from "@roguemouse/schemas";

type VoiceStyle = {
  label: string;
  bg: string;
  border: string;
  fg: string;
};

const NEUTRAL: VoiceStyle = {
  label: "tool",
  bg: "var(--color-faint)",
  border: "var(--color-rule)",
  fg: "var(--color-muted)",
};

const STYLES: Record<RecordTypeName, VoiceStyle> = {
  "smoke_test:chat_completion": {
    label: "smoke",
    bg: "var(--color-faint)",
    border: "var(--color-rule)",
    fg: "var(--color-muted)",
  },
  "tool:call": { ...NEUTRAL, label: "tool:call" },
  "tool:result": { ...NEUTRAL, label: "tool:result" },
  "anomaly:detected": {
    label: "anomaly",
    bg: "var(--color-anomaly-dim)",
    border: "var(--color-anomaly-border)",
    fg: "var(--color-anomaly)",
  },
  "risk_officer:reasoning": {
    label: "risk officer",
    bg: "var(--color-voice-risk-dim)",
    border: "var(--color-voice-risk-border)",
    fg: "var(--color-voice-risk)",
  },
  "ops_engineer:reasoning": {
    label: "ops engineer",
    bg: "var(--color-voice-ops-dim)",
    border: "var(--color-voice-ops-border)",
    fg: "var(--color-voice-ops)",
  },
  "synthesizer:reasoning": {
    label: "synthesizer",
    bg: "var(--color-voice-synth-dim)",
    border: "var(--color-voice-synth-border)",
    fg: "var(--color-voice-synth)",
  },
  "synthesizer:proposal": {
    label: "proposal",
    bg: "var(--color-positive-dim)",
    border: "var(--color-positive-border)",
    fg: "var(--color-positive)",
  },
  "synthesizer:refusal": {
    label: "refusal",
    bg: "var(--color-caution-dim)",
    border: "var(--color-caution-border)",
    fg: "var(--color-caution)",
  },
  "human:approval": {
    label: "approval",
    bg: "var(--color-positive-dim)",
    border: "var(--color-positive-border)",
    fg: "var(--color-positive)",
  },
  "human:rejection": {
    label: "rejection",
    bg: "var(--color-caution-dim)",
    border: "var(--color-caution-border)",
    fg: "var(--color-caution)",
  },
  "final:committed": {
    label: "committed",
    bg: "var(--color-positive-dim)",
    border: "var(--color-positive-border)",
    fg: "var(--color-positive)",
  },
};

export function voiceColorFor(recordType: RecordTypeName | "unknown"): string {
  if (recordType === "unknown") return "var(--color-muted)";
  return STYLES[recordType].fg;
}

export function VoiceBadge({
  recordType,
  className,
}: {
  recordType: RecordTypeName | "unknown";
  className?: string;
}) {
  if (recordType === "unknown") {
    return <Badge variant="outline" className={className}>unknown</Badge>;
  }
  const s = STYLES[recordType];
  const style: CSSProperties = {
    backgroundColor: s.bg,
    borderColor: s.border,
    color: s.fg,
  };
  return (
    <Badge className={`${className ?? ""} border`} style={style}>
      {s.label}
    </Badge>
  );
}
