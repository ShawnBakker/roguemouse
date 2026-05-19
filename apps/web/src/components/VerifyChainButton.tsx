"use client";

/*
 * Client-side audit-chain verifier — mirrors the writer protocol exactly.
 *
 * Hash protocol (truth source: packages/audit/src/runAuditWriter.ts and
 * packages/schemas/src/canonicalize.ts and packages/audit/src/sha256.ts):
 *
 *   1. Each record's hashed body is the 5-field envelope:
 *        { ts, runId, recordType, previousHash, payload }
 *      (no `currentHash` field exists inside the body; the hash is the
 *       output of hashing the body and is stored only in the S3 key + S3
 *       metadata).
 *
 *   2. Canonicalization: recursively sort object keys lexicographically;
 *      JSON.stringify with no whitespace. Integers must be in the safe-
 *      integer range; no floats, no NaN/Infinity, no Date/Map/Set, no
 *      BigInt. The schemas package's canonicalize() is pure JS and is
 *      reused unchanged here.
 *
 *   3. Hash: SHA-256 of the UTF-8 bytes of the canonical string, encoded
 *      as 64-character lowercase hex.
 *
 *   4. Chain link: record N's previousHash must equal computeHash(record
 *      N-1). Record 1's previousHash must equal GENESIS_HASH, which is
 *      sha256("roguemouse-audit-genesis-v1") =
 *      b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc.
 *
 * Browser-side reuse decisions:
 *   - canonicalize  → reused from @roguemouse/schemas (pure JS).
 *   - sha256        → Node-only in the writer; replaced here with the
 *                     js-sha256 library (pure-JS, no Web Crypto dependency).
 *                     Web Crypto's crypto.subtle is gated to secure contexts
 *                     per W3C spec § 1.4; production runs over HTTP on
 *                     sslip.io (Let's Encrypt rate-limit deviation from
 *                     Phase 4) so crypto.subtle is undefined there. js-sha256
 *                     works in any context.
 *   - GENESIS_HASH  → Node-only in @roguemouse/audit (uses node:crypto);
 *                     passed in as a prop from the server component.
 *
 * Any divergence between this file and the writer protocol will cause
 * canonical runs to mis-verify. The pinned canonical runs (Sprint 4c's
 * cfbafd8c-... clean and 381dd171-... degraded) are the regression
 * fixtures: if they ever fail this verifier, this file (or canonicalize)
 * is out of sync with the writer. The offline verifier
 * (scripts/verify-chain-offline.ts) uses node:crypto's webcrypto and is
 * the protocol-parity ground truth.
 */

import { sha256 } from "js-sha256";
import { useState } from "react";

import { canonicalize, type AuditRecordBody } from "@roguemouse/schemas";

export type VerifyItem = {
  record: AuditRecordBody;
  hash: string;
};

type RecordVerdict =
  | { ok: true }
  | { ok: false; reason: "chain_break" | "hash_mismatch"; detail: string };

type Verdict =
  | { state: "idle" }
  | { state: "running"; currentIndex: number }
  | { state: "passed"; checked: number }
  | { state: "failed"; failedIndex: number; reason: RecordVerdict };

function sha256Hex(text: string): string {
  return sha256(text);
}

async function verifyRecord(
  item: VerifyItem,
  expectedPrevious: string,
): Promise<RecordVerdict & { computedHash?: string }> {
  if (item.record.previousHash !== expectedPrevious) {
    return {
      ok: false,
      reason: "chain_break",
      detail: `expected previousHash ${expectedPrevious}, got ${item.record.previousHash}`,
    };
  }
  let canonical: string;
  try {
    canonical = canonicalize(item.record);
  } catch (err) {
    return {
      ok: false,
      reason: "hash_mismatch",
      detail: `canonicalize threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const computedHash = sha256Hex(canonical);
  if (computedHash !== item.hash) {
    return {
      ok: false,
      reason: "hash_mismatch",
      detail: `computed ${computedHash}, stored ${item.hash}`,
    };
  }
  return { ok: true, computedHash };
}

export function VerifyChainButton({
  items,
  genesisHash,
}: {
  items: readonly VerifyItem[];
  genesisHash: string;
}) {
  const [verdict, setVerdict] = useState<Verdict>({ state: "idle" });

  async function onClick() {
    if (verdict.state === "running") return;
    setVerdict({ state: "running", currentIndex: 0 });
    let expectedPrevious = genesisHash;
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      setVerdict({ state: "running", currentIndex: i });
      const result = await verifyRecord(item, expectedPrevious);
      if (!result.ok) {
        setVerdict({
          state: "failed",
          failedIndex: i,
          reason: result,
        });
        return;
      }
      expectedPrevious = item.hash;
    }
    setVerdict({ state: "passed", checked: items.length });
  }

  const disabled = verdict.state === "running";

  let face: { bg: string; fg: string; border: string; label: string };
  switch (verdict.state) {
    case "idle":
      face = {
        bg: "var(--color-surface)",
        fg: "var(--color-ink)",
        border: "var(--color-rule)",
        label: `Verify chain (${items.length} records)`,
      };
      break;
    case "running":
      face = {
        bg: "var(--color-faint)",
        fg: "var(--color-muted)",
        border: "var(--color-rule)",
        label: `Verifying record ${verdict.currentIndex + 1}/${items.length}…`,
      };
      break;
    case "passed":
      face = {
        bg: "var(--color-positive-dim)",
        fg: "var(--color-positive)",
        border: "var(--color-positive-border)",
        label: `✓ All ${verdict.checked} records verified — hash chain intact`,
      };
      break;
    case "failed":
      face = {
        bg: "var(--color-anomaly-dim)",
        fg: "var(--color-anomaly)",
        border: "var(--color-anomaly-border)",
        label: `✗ Verification failed at record ${String(
          verdict.failedIndex + 1,
        ).padStart(2, "0")} — ${
          verdict.reason.ok ? "" : verdict.reason.reason.replace("_", " ")
        }`,
      };
      break;
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="w-full px-4 py-3 text-body border transition-colors text-left flex items-center justify-between gap-3"
        style={{
          backgroundColor: face.bg,
          color: face.fg,
          borderColor: face.border,
        }}
      >
        <span>{face.label}</span>
        <span className="mono text-caption" style={{ color: face.fg, opacity: 0.7 }}>
          {verdict.state === "idle" ? "SHA-256 · client-side" : null}
        </span>
      </button>
      {verdict.state === "failed" && !verdict.reason.ok ? (
        <p className="mono text-caption" style={{ color: "var(--color-anomaly)" }}>
          {verdict.reason.detail}
        </p>
      ) : null}
    </div>
  );
}
