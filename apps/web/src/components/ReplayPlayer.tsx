"use client";

import { useEffect, useRef, useState } from "react";

import { RecordCard } from "@/components/RecordCard";
import type { AuditRecordBody } from "@roguemouse/schemas";

export type ReplayItem = {
  key: string;
  hash: string;
  record: AuditRecordBody;
};

const STEP_MS = 2200;

export function ReplayPlayer({ items }: { items: readonly ReplayItem[] }) {
  const total = items.length;
  const [revealed, setRevealed] = useState<number>(total > 0 ? 1 : 0);
  const [playing, setPlaying] = useState<boolean>(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!playing) return;
    if (revealed >= total) return;
    timer.current = setTimeout(() => {
      setRevealed((n) => Math.min(n + 1, total));
    }, STEP_MS);
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [playing, revealed, total]);

  const done = revealed >= total;
  const elapsedSeconds = Math.min(revealed, total) * (STEP_MS / 1000) - (STEP_MS / 1000);
  const totalSeconds = total * (STEP_MS / 1000) - (STEP_MS / 1000);

  return (
    <section className="space-y-4">
      <div
        className="flex flex-wrap items-center gap-3 pb-3 border-b"
        style={{ borderColor: "var(--color-rule)" }}
      >
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          disabled={done}
          className="px-3 py-1.5 text-small border"
          style={{
            backgroundColor: done ? "var(--color-faint)" : "var(--color-ink)",
            color: done ? "var(--color-muted)" : "var(--color-bg)",
            borderColor: done ? "var(--color-rule)" : "var(--color-ink)",
          }}
        >
          {done ? "Done" : playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          onClick={() => {
            if (timer.current !== null) {
              clearTimeout(timer.current);
              timer.current = null;
            }
            setRevealed(total > 0 ? 1 : 0);
            setPlaying(true);
          }}
          className="px-3 py-1.5 text-small border"
          style={{
            backgroundColor: "var(--color-surface)",
            color: "var(--color-ink)",
            borderColor: "var(--color-rule)",
          }}
        >
          Restart
        </button>
        <span
          className="mono text-caption ml-auto"
          style={{ color: "var(--color-muted)" }}
        >
          {revealed}/{total} records · {Math.max(0, elapsedSeconds).toFixed(1)}s /{" "}
          {totalSeconds.toFixed(1)}s
        </span>
      </div>

      <div className="space-y-3">
        {items.slice(0, revealed).map((item, i) => (
          <div
            key={item.key}
            className="animate-in fade-in slide-in-from-bottom-2 duration-300"
          >
            <RecordCard
              record={item.record}
              ordinal={i + 1}
              currentHash={item.hash}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
