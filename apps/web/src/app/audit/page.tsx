import Link from "next/link";

import { VoiceBadge } from "@/components/VoiceBadge";
import { listRuns } from "@/lib/bucketReader";

export const dynamic = "force-dynamic";

export default async function AuditIndex() {
  const result = await listRuns();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 space-y-8">
      <header className="space-y-2">
        <Link
          href="/"
          className="text-small underline"
          style={{ color: "var(--color-muted)" }}
        >
          ← back
        </Link>
        <h1
          className="text-h1"
          style={{
            fontFamily: "Trebuchet MS, Lucida Grande, sans-serif",
            fontWeight: 600,
            letterSpacing: "0.05em",
          }}
        >
          AUDIT LOG
        </h1>
        <p className="text-body" style={{ color: "var(--color-muted)" }}>
          Every record committed to the Vultr Object Storage bucket
          {" "}
          <span className="mono text-small">roguemouse-audit-log</span>, grouped by
          run. SHA-256 hash-chained, RFC 8785-style canonical JSON.
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
          <strong className="text-label">audit log unavailable</strong>
          <p className="mono text-caption mt-1">
            {result.error.code}: {result.error.message}
          </p>
        </div>
      ) : result.data.length === 0 ? (
        <p className="text-body" style={{ color: "var(--color-muted)" }}>
          No runs in the bucket yet.
        </p>
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--color-rule)" }}>
          {result.data.map((run) => (
            <li
              key={run.runId}
              className="py-4 border-b"
              style={{ borderColor: "var(--color-rule)" }}
            >
              <Link
                href={`/audit/${run.runId}`}
                className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 hover:opacity-70 transition-opacity"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <VoiceBadge recordType={run.terminalRecordType} />
                    <span className="mono text-small" style={{ color: "var(--color-ink)" }}>
                      {run.runId}
                    </span>
                  </div>
                  <span
                    className="mono text-caption block"
                    style={{ color: "var(--color-muted)" }}
                  >
                    {run.firstTs || "—"} → {run.lastTs || "—"}
                  </span>
                </div>
                <span
                  className="mono text-caption md:text-right md:self-center"
                  style={{ color: "var(--color-muted)" }}
                >
                  {run.recordCount} record{run.recordCount === 1 ? "" : "s"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
