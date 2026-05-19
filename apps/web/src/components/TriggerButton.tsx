"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type ScenarioResponse =
  | {
      ok: true;
      runId: string;
      recordCount: number;
      terminalRecordType: string;
      symbol?: string;
    }
  | { ok: false; error: { code: string; message: string } };

const SYMBOL_PATTERN = /^[A-Z0-9-]{0,8}$/;

function normalizeInput(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 8);
}

function messageFor(elapsedMs: number, symbol: string): string {
  const s = elapsedMs / 1000;
  if (s < 5) return `Detecting anomaly for ${symbol}…`;
  if (s < 15) return "Risk Officer reasoning…";
  if (s < 22) return "Ops Engineer dispatching tools…";
  if (s < 30) return "Synthesizer reconciling perspectives…";
  return "Almost done…";
}

export function TriggerButton({
  alreadyTriggered,
  triggeredRunId,
}: {
  alreadyTriggered: boolean;
  triggeredRunId: string | null;
}) {
  const router = useRouter();
  const [symbolInput, setSymbolInput] = useState("");
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submittedSymbol, setSubmittedSymbol] = useState<string>("AAPL");
  const [resetting, setResetting] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function onResetClick() {
    if (resetting) return;
    setResetting(true);
    try {
      const res = await fetch("/api/session/reset", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      window.location.reload();
    } catch (err) {
      console.error("session reset failed:", err);
      setResetting(false);
    }
  }

  useEffect(() => {
    if (state !== "running") return;
    const start = Date.now();
    tickRef.current = setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, 250);
    return () => {
      if (tickRef.current !== null) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [state]);

  async function onClick() {
    if (state === "running" || alreadyTriggered) return;
    const normalized = normalizeInput(symbolInput);
    const effective = normalized.length > 0 ? normalized : "AAPL";
    setSubmittedSymbol(effective);
    setErrorMsg(null);
    setElapsedMs(0);
    setState("running");
    try {
      const res = await fetch("/api/scenario", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: effective }),
      });
      const data = (await res.json()) as ScenarioResponse;
      if (!res.ok || !data.ok) {
        const msg = data.ok ? `HTTP ${res.status}` : data.error.message;
        setErrorMsg(msg);
        setState("error");
        return;
      }
      router.push(`/audit/${data.runId}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }

  const disabled = alreadyTriggered || state === "running";
  const inputDisabled = disabled;
  const inputInvalid =
    symbolInput.length > 0 && !SYMBOL_PATTERN.test(normalizeInput(symbolInput));

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label
          htmlFor="symbol-input"
          className="text-label block"
          style={{ color: "var(--color-muted)" }}
        >
          Symbol
        </label>
        <input
          id="symbol-input"
          type="text"
          value={symbolInput}
          onChange={(e) => setSymbolInput(e.target.value)}
          placeholder="AAPL"
          maxLength={8}
          disabled={inputDisabled}
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          className="w-full px-3 py-2 text-body mono border transition-opacity disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2"
          style={{
            backgroundColor: "var(--color-surface)",
            color: "var(--color-ink)",
            borderColor: inputInvalid
              ? "var(--color-anomaly-border)"
              : "var(--color-rule)",
          }}
        />
        <p
          className="mono text-caption"
          style={{ color: "var(--color-muted)" }}
        >
          1–8 chars · letters, digits, hyphen · empty defaults to AAPL
        </p>
      </div>

      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="w-full px-6 py-4 text-h3 border transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
        style={{
          backgroundColor: disabled ? "var(--color-faint)" : "var(--color-ink)",
          color: disabled ? "var(--color-muted)" : "var(--color-bg)",
          borderColor: disabled ? "var(--color-rule)" : "var(--color-ink)",
        }}
      >
        {state === "running"
          ? messageFor(elapsedMs, submittedSymbol)
          : alreadyTriggered
            ? "Already triggered"
            : "Trigger live run"}
      </button>

      {state === "running" ? (
        <p className="mono text-caption" style={{ color: "var(--color-muted)" }}>
          elapsed {(elapsedMs / 1000).toFixed(1)}s · expect ~30s · writes ~15
          records to the audit log
        </p>
      ) : null}

      {alreadyTriggered && triggeredRunId !== null ? (
        <p className="text-small" style={{ color: "var(--color-muted)" }}>
          This browser session already triggered{" "}
          <a
            href={`/audit/${triggeredRunId}`}
            className="underline"
            style={{ color: "var(--color-ink)" }}
          >
            {triggeredRunId.slice(0, 8)}…
          </a>
          . Open a fresh browser to trigger another.
        </p>
      ) : null}

      {alreadyTriggered ? (
        <div className="pt-1">
          <button
            type="button"
            onClick={onResetClick}
            disabled={resetting}
            className="text-small underline hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ color: "var(--color-muted)" }}
          >
            {resetting ? "Resetting…" : "Reset session"}
          </button>
          <p
            className="text-caption mt-1"
            style={{ color: "var(--color-muted)" }}
          >
            Clears the cookie gate for a fresh run.
          </p>
        </div>
      ) : null}

      {state === "error" && errorMsg !== null ? (
        <div
          className="p-3 border text-small"
          style={{
            backgroundColor: "var(--color-anomaly-dim)",
            borderColor: "var(--color-anomaly-border)",
            color: "var(--color-anomaly)",
          }}
        >
          <strong className="text-label">scenario failed</strong>
          <p className="mono text-caption mt-1">{errorMsg}</p>
        </div>
      ) : null}
    </div>
  );
}
