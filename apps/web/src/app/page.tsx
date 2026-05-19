import Link from "next/link";

import { ReplayPlayer, type ReplayItem } from "@/components/ReplayPlayer";
import { TerminalDispositionCard } from "@/components/TerminalDispositionCard";
import { TriggerButton } from "@/components/TriggerButton";
import { VariantToggle } from "@/components/VariantToggle";
import { listRunKeysForRun, readRecordByKey } from "@/lib/bucketReader";
import { CANONICAL_RUNS, isVariant, type Variant } from "@/lib/canonicalRuns";
import {
  getTriggeredRunId,
  hasTriggered,
  readSessionId,
} from "@/lib/sessionGate";

export const dynamic = "force-dynamic";

const HASH_FROM_KEY = /-([0-9a-f]{64})\.json$/;

function hashFromKey(key: string): string {
  const m = key.match(HASH_FROM_KEY);
  return m ? (m[1] ?? "") : "";
}

async function loadReplay(runId: string): Promise<{
  items: readonly ReplayItem[];
  error: string | null;
}> {
  const keysResult = await listRunKeysForRun(runId);
  if (!keysResult.ok) {
    return { items: [], error: `${keysResult.error.code}: ${keysResult.error.message}` };
  }
  const sortedKeys = [...keysResult.data].sort();
  const items: ReplayItem[] = [];
  for (const key of sortedKeys) {
    const r = await readRecordByKey(key);
    if (!r.ok) {
      return { items, error: `${r.error.code}: ${r.error.message}` };
    }
    items.push({ key, hash: hashFromKey(key), record: r.data.record });
  }
  return { items, error: null };
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const variantParam = params.variant;
  const variant: Variant = isVariant(variantParam) ? variantParam : "clean";
  const canonical = CANONICAL_RUNS[variant];

  const sessionId = await readSessionId();
  const triggered = sessionId !== null ? hasTriggered(sessionId) : false;
  const triggeredRunId =
    triggered && sessionId !== null ? getTriggeredRunId(sessionId) : null;

  const replay = await loadReplay(canonical.runId);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 space-y-10">
      <header className="space-y-2">
        <h1
          className="text-h1"
          style={{
            fontFamily: "Trebuchet MS, Lucida Grande, sans-serif",
            fontWeight: 600,
            letterSpacing: "0.05em",
          }}
        >
          ROGUEMOUSE
        </h1>
        <p className="text-body" style={{ color: "var(--color-muted)" }}>
          AI Operations Officer for algorithmic trading platforms — audit-grade
          governance, no live trades.
        </p>
      </header>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-label">canonical run</p>
          <VariantToggle defaultVariant="clean" />
        </div>

        <div
          className="flex flex-wrap gap-x-6 gap-y-1 mono text-caption"
          style={{ color: "var(--color-muted)" }}
        >
          <span>variant {variant}</span>
          <span>runId {canonical.runId.slice(0, 8)}…</span>
          <span>{canonical.recordCount} records</span>
          <span>decision {canonical.decision}</span>
          <span>confidence {(canonical.confidenceBp / 100).toFixed(0)}%</span>
          <span>elapsed {(canonical.totalElapsedMs / 1000).toFixed(1)}s</span>
        </div>
      </section>

      {replay.error !== null ? (
        <div
          className="p-3 border text-small"
          style={{
            backgroundColor: "var(--color-anomaly-dim)",
            borderColor: "var(--color-anomaly-border)",
            color: "var(--color-anomaly)",
          }}
        >
          <strong className="text-label">replay unavailable</strong>
          <p className="mono text-caption mt-1">{replay.error}</p>
        </div>
      ) : (
        <>
          {replay.items.length > 0 ? (
            <TerminalDispositionCard
              record={replay.items[replay.items.length - 1]!.record}
              elapsedSeconds={canonical.totalElapsedMs / 1000}
            />
          ) : null}

          <section className="space-y-3">
            <p className="text-label">Try your own</p>
            <p className="text-small" style={{ color: "var(--color-muted)" }}>
              Pick a ticker. The agent reasons about your symbol against the
              same synthetic IV/RV anomaly pattern the canonical run
              demonstrates, producing a fresh 15-record audit chain rooted at
              genesis.
            </p>
            <TriggerButton
              alreadyTriggered={triggered}
              triggeredRunId={triggeredRunId}
            />
          </section>

          <section className="space-y-3">
            <p className="text-label">Canonical replay</p>
            <ReplayPlayer items={replay.items} />
          </section>
        </>
      )}

      <footer
        className="pt-6 border-t flex flex-wrap items-center justify-between gap-3 text-small"
        style={{ borderColor: "var(--color-rule)", color: "var(--color-muted)" }}
      >
        <Link
          href="/audit"
          className="underline"
          style={{ color: "var(--color-ink)" }}
        >
          View audit log →
        </Link>
        <span className="mono text-caption">no live trades · hackathon demo</span>
      </footer>
    </main>
  );
}
