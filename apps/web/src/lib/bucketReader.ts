import {
  RunAuditWriter,
  createS3Client,
  sha256Hex,
} from "@roguemouse/audit";
import {
  auditRecordBodySchema,
  canonicalize,
  type AuditRecordBody,
  type RecordTypeName,
} from "@roguemouse/schemas";

const S3_ENDPOINT = "https://ams1.vultrobjects.com";
const S3_REGION = "ams1";
const S3_BUCKET = "roguemouse-audit-log";

const PLACEHOLDER_RUN_ID = "00000000-0000-0000-0000-000000000000";

type ReaderState = {
  writer: RunAuditWriter;
};

let state: ReaderState | null = null;
let envError: string | null = null;

function getState(): ReaderState | { error: string } {
  if (state !== null) return state;
  if (envError !== null) return { error: envError };

  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  if (!accessKeyId || !secretAccessKey) {
    envError = "S3_ACCESS_KEY or S3_SECRET_KEY env var is not set";
    return { error: envError };
  }

  const s3Client = createS3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    accessKeyId,
    secretAccessKey,
  });
  const writer = new RunAuditWriter({
    s3Client,
    bucket: S3_BUCKET,
    runId: PLACEHOLDER_RUN_ID,
    canonicalize,
    sha256Hex,
  });
  state = { writer };
  return state;
}

export type RunSummary = {
  runId: string;
  recordCount: number;
  firstTs: string;
  lastTs: string;
  terminalRecordType: RecordTypeName | "unknown";
};

export type ReaderResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

function parseRunIdFromKey(key: string): string | null {
  const m = key.match(/^audit\/([^/]+)\//);
  return m ? (m[1] ?? null) : null;
}

function parseTsFromKey(key: string): string | null {
  const m = key.match(
    /audit\/[^/]+\/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z)-[0-9a-f]{64}\.json$/,
  );
  if (!m || !m[1]) return null;
  const tsSafe = m[1];
  const tIdx = tsSafe.indexOf("T");
  if (tIdx < 0) return null;
  const datePart = tsSafe.slice(0, tIdx);
  const timePart = tsSafe.slice(tIdx + 1).replace(/-/g, ":");
  return `${datePart}T${timePart}`;
}

export async function listAllRunKeys(): Promise<ReaderResult<readonly string[]>> {
  const s = getState();
  if ("error" in s) return { ok: false, error: { code: "env_missing", message: s.error } };

  const result = await s.writer.list({ limit: 1000 });
  if (!result.ok) {
    return {
      ok: false,
      error: { code: result.error.code, message: result.error.message },
    };
  }
  return { ok: true, data: result.data.keys };
}

export async function listRunKeysForRun(
  runId: string,
): Promise<ReaderResult<readonly string[]>> {
  const s = getState();
  if ("error" in s) return { ok: false, error: { code: "env_missing", message: s.error } };

  const result = await s.writer.list({ runIdPrefix: runId, limit: 100 });
  if (!result.ok) {
    return {
      ok: false,
      error: { code: result.error.code, message: result.error.message },
    };
  }
  return { ok: true, data: result.data.keys };
}

export async function readRecordByKey(
  key: string,
): Promise<ReaderResult<{ record: AuditRecordBody; key: string }>> {
  const s = getState();
  if ("error" in s) return { ok: false, error: { code: "env_missing", message: s.error } };

  const result = await s.writer.read(key);
  if (!result.ok) {
    return { ok: false, error: { code: result.error.code, message: result.error.message } };
  }
  const parsed = auditRecordBodySchema.safeParse(result.data.parsed);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "schema_invalid", message: parsed.error.message },
    };
  }
  return { ok: true, data: { record: parsed.data, key } };
}

export async function readRun(
  runId: string,
): Promise<ReaderResult<readonly { record: AuditRecordBody; key: string }[]>> {
  const keysResult = await listRunKeysForRun(runId);
  if (!keysResult.ok) return keysResult;

  const sortedKeys = [...keysResult.data].sort();
  const records: { record: AuditRecordBody; key: string }[] = [];
  for (const key of sortedKeys) {
    const r = await readRecordByKey(key);
    if (!r.ok) return r;
    records.push(r.data);
  }
  return { ok: true, data: records };
}

export async function listRuns(): Promise<ReaderResult<readonly RunSummary[]>> {
  const keysResult = await listAllRunKeys();
  if (!keysResult.ok) return keysResult;

  const byRun = new Map<string, string[]>();
  for (const key of keysResult.data) {
    const runId = parseRunIdFromKey(key);
    if (!runId) continue;
    const bucket = byRun.get(runId) ?? [];
    bucket.push(key);
    byRun.set(runId, bucket);
  }

  const summaries: RunSummary[] = [];
  for (const [runId, keys] of byRun.entries()) {
    const sorted = [...keys].sort();
    const firstKey = sorted[0]!;
    const lastKey = sorted[sorted.length - 1]!;
    const firstTs = parseTsFromKey(firstKey) ?? "";
    const lastTs = parseTsFromKey(lastKey) ?? "";

    let terminalRecordType: RecordTypeName | "unknown" = "unknown";
    const terminal = await readRecordByKey(lastKey);
    if (terminal.ok) {
      terminalRecordType = terminal.data.record.recordType;
    }

    summaries.push({
      runId,
      recordCount: keys.length,
      firstTs,
      lastTs,
      terminalRecordType,
    });
  }

  summaries.sort((a, b) => (a.lastTs < b.lastTs ? 1 : a.lastTs > b.lastTs ? -1 : 0));
  return { ok: true, data: summaries };
}
