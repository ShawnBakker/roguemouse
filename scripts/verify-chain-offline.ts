/*
 * Offline mirror of apps/web/src/components/VerifyChainButton.tsx's
 * verification logic. Used as a high-confidence pre-flight: if a
 * canonical run verifies clean here, it should verify clean in the
 * browser too, because the protocol below mirrors the client component
 * byte-for-byte (only the SHA-256 backend differs — Node's webcrypto
 * here vs window.crypto.subtle there, both produce identical output).
 *
 * Usage:
 *   pnpm tsx scripts/verify-chain-offline.ts <runId> [<runId> ...]
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";

import { config as loadDotenv } from "dotenv";

import {
  GENESIS_HASH,
  RunAuditWriter,
  createS3Client,
  sha256Hex,
} from "@roguemouse/audit";
import {
  auditRecordBodySchema,
  canonicalize,
  type AuditRecordBody,
} from "@roguemouse/schemas";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, "..");
const ENV = path.join(REPO_ROOT, ".env.local");
if (existsSync(ENV)) loadDotenv({ path: ENV });

const S3_ENDPOINT = "https://ams1.vultrobjects.com";
const S3_REGION = "ams1";
const S3_BUCKET = "roguemouse-audit-log";
const PLACEHOLDER = "00000000-0000-0000-0000-000000000000";

const ak = process.env.S3_ACCESS_KEY;
const sk = process.env.S3_SECRET_KEY;
if (!ak || !sk) {
  console.error("env_missing: S3_ACCESS_KEY / S3_SECRET_KEY");
  process.exit(1);
}

const s3 = createS3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  accessKeyId: ak,
  secretAccessKey: sk,
});
const writer = new RunAuditWriter({
  s3Client: s3,
  bucket: S3_BUCKET,
  runId: PLACEHOLDER,
  canonicalize,
  sha256Hex,
});

const HASH_FROM_KEY = /-([0-9a-f]{64})\.json$/;
function hashFromKey(key: string): string {
  const m = key.match(HASH_FROM_KEY);
  return m ? (m[1] ?? "") : "";
}

async function sha256HexBrowserStyle(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await webcrypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

async function verifyRun(runId: string): Promise<void> {
  const list = await writer.list({ runIdPrefix: runId, limit: 100 });
  if (!list.ok) {
    console.error(`[${runId}] list failed: ${list.error.code}: ${list.error.message}`);
    process.exit(2);
  }
  const keys = [...list.data.keys].sort();
  if (keys.length === 0) {
    console.error(`[${runId}] no records under this runId`);
    process.exit(2);
  }

  const items: { record: AuditRecordBody; hash: string; key: string }[] = [];
  for (const key of keys) {
    const r = await writer.read(key);
    if (!r.ok) {
      console.error(`[${runId}] read failed at ${key}: ${r.error.code}: ${r.error.message}`);
      process.exit(2);
    }
    const parsed = auditRecordBodySchema.safeParse(r.data.parsed);
    if (!parsed.success) {
      console.error(`[${runId}] schema_invalid at ${key}: ${parsed.error.message}`);
      process.exit(2);
    }
    items.push({ record: parsed.data, hash: hashFromKey(key), key });
  }

  let expectedPrevious = GENESIS_HASH;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (it.record.previousHash !== expectedPrevious) {
      console.error(
        `[${runId}] CHAIN_BREAK at record ${String(i + 1).padStart(2, "0")}:\n` +
          `  expected previousHash ${expectedPrevious}\n` +
          `  got                   ${it.record.previousHash}`,
      );
      process.exit(3);
    }
    const canon = canonicalize(it.record);
    const computed = await sha256HexBrowserStyle(canon);
    if (computed !== it.hash) {
      console.error(
        `[${runId}] HASH_MISMATCH at record ${String(i + 1).padStart(2, "0")}:\n` +
          `  computed ${computed}\n` +
          `  stored   ${it.hash}\n` +
          `  key      ${it.key}`,
      );
      process.exit(3);
    }
    expectedPrevious = it.hash;
  }
  console.log(
    `[${runId}] OK — all ${items.length} records verified · chain root → ${expectedPrevious.slice(0, 8)}…${expectedPrevious.slice(-4)}`,
  );
}

async function main(): Promise<void> {
  const runIds = process.argv.slice(2);
  if (runIds.length === 0) {
    console.error("usage: pnpm tsx scripts/verify-chain-offline.ts <runId> [<runId> ...]");
    process.exit(1);
  }
  for (const r of runIds) {
    await verifyRun(r);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("uncaught:", err);
  process.exit(4);
});
