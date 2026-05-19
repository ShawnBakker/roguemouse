import Link from "next/link";

import { GenesisBanner } from "@/components/ChainVisualization";
import { RecordCard } from "@/components/RecordCard";
import { TerminalDispositionCard } from "@/components/TerminalDispositionCard";
import { readRun } from "@/lib/bucketReader";

export const dynamic = "force-dynamic";

const HASH_FROM_KEY = /-([0-9a-f]{64})\.json$/;

function hashFromKey(key: string): string {
  const m = key.match(HASH_FROM_KEY);
  return m ? (m[1] ?? "") : "";
}

export default async function AuditRun({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const result = await readRun(runId);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 space-y-6">
      <header className="space-y-2">
        <Link
          href="/audit"
          className="text-small underline"
          style={{ color: "var(--color-muted)" }}
        >
          ← all runs
        </Link>
        <h1
          className="text-h1"
          style={{
            fontFamily: "Trebuchet MS, Lucida Grande, sans-serif",
            fontWeight: 600,
            letterSpacing: "0.05em",
          }}
        >
          RUN
        </h1>
        <p className="mono text-small" style={{ color: "var(--color-muted)" }}>
          {runId}
        </p>
      </header>

      {!result.ok ? (
        <div
          className="p-3 border text-small"
          style={{
            backgroundColor: "var(--color-anomaly-dim)",
            borderColor: "var(--color-anomaly-border)",
            color: "var(--color-anomaly)",
          }}
        >
          <strong className="text-label">run unavailable</strong>
          <p className="mono text-caption mt-1">
            {result.error.code}: {result.error.message}
          </p>
        </div>
      ) : result.data.length === 0 ? (
        <p className="text-body" style={{ color: "var(--color-muted)" }}>
          No records under this runId.
        </p>
      ) : (() => {
        const records = result.data;
        const first = records[0]!;
        const last = records[records.length - 1]!;
        const startMs = Date.parse(first.record.ts);
        const endMs = Date.parse(last.record.ts);
        const elapsedSeconds =
          Number.isFinite(startMs) && Number.isFinite(endMs)
            ? (endMs - startMs) / 1000
            : null;
        return (
          <div className="space-y-3">
            <TerminalDispositionCard
              record={last.record}
              elapsedSeconds={elapsedSeconds}
            />
            <GenesisBanner previousHash={first.record.previousHash} />
            {records.map((item, i) => (
              <RecordCard
                key={item.key}
                record={item.record}
                ordinal={i + 1}
                currentHash={hashFromKey(item.key)}
              />
            ))}
          </div>
        );
      })()}
    </main>
  );
}
