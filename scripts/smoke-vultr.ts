// 1. Node built-ins
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 2. Third-party
import { config as loadDotenv } from "dotenv";

// 3. Workspace
import {
  GENESIS_HASH,
  RunAuditWriter,
  createS3Client,
  sha256Hex,
} from "@roguemouse/audit";
import {
  chatCompletion,
  createInferenceClient,
} from "@roguemouse/inference";
import { canonicalize } from "@roguemouse/schemas";

// ---------------------------------------------------------------------------
// Bootstrap: locate and load .env.local from the repo root (one level up
// from this script's directory). Must run before any code reads process.env.
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_LOCAL_PATH = path.join(__dirname, "..", ".env.local");

if (!existsSync(ENV_LOCAL_PATH)) {
  console.error("=== FAIL ===");
  console.error("step    : env_load");
  console.error(`message : .env.local not found at ${ENV_LOCAL_PATH}`);
  console.error("");
  console.error("Create it by copying .env.example at the repo root and");
  console.error("filling in the three required secrets from the password manager:");
  console.error("  VULTR_INFERENCE_API_KEY → roguemouse-vultr-inference-key");
  console.error("  S3_ACCESS_KEY           → roguemouse-s3-access-key");
  console.error("  S3_SECRET_KEY           → roguemouse-s3-secret-key");
  process.exit(1);
}

const dotenvResult = loadDotenv({ path: ENV_LOCAL_PATH });
if (dotenvResult.error) {
  console.error("=== FAIL ===");
  console.error("step    : env_load");
  console.error(`message : Failed to parse ${ENV_LOCAL_PATH}: ${dotenvResult.error.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Env validation. Collect ALL missing required vars in one pass so the
// operator gets the full list per the spec's edge case for AC-02 / AC-03 /
// AC-04 / AC-05.
// ---------------------------------------------------------------------------

type RequiredEnv = {
  VULTR_INFERENCE_API_KEY: string;
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
};

const REQUIRED_VARS: ReadonlyArray<keyof RequiredEnv> = [
  "VULTR_INFERENCE_API_KEY",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
];

const envAcc: Partial<RequiredEnv> = {};
const missing: string[] = [];

for (const name of REQUIRED_VARS) {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    missing.push(name);
  } else {
    envAcc[name] = raw;
  }
}

if (missing.length > 0) {
  console.error("=== FAIL ===");
  console.error("step    : env_validation");
  console.error("message : Missing required environment variable(s) in .env.local");
  console.error(`missing : ${missing.join(", ")}`);
  console.error(`source  : ${ENV_LOCAL_PATH}`);
  console.error("");
  console.error("Populate the missing variables from the password manager:");
  for (const name of missing) {
    const pwEntry = {
      VULTR_INFERENCE_API_KEY: "roguemouse-vultr-inference-key",
      S3_ACCESS_KEY: "roguemouse-s3-access-key",
      S3_SECRET_KEY: "roguemouse-s3-secret-key",
    }[name];
    console.error(`  ${name} → ${pwEntry}`);
  }
  process.exit(1);
}

const env = envAcc as RequiredEnv;

// ---------------------------------------------------------------------------
// Locked constants. Per the spec, the endpoint / region / bucket / model are
// "locked" — they live in the runner, not in env. The .env.example file
// over-documents them for future flexibility.
// ---------------------------------------------------------------------------

const INFERENCE_BASE_URL = "https://api.vultrinference.com/v1";
const S3_ENDPOINT = "https://ams1.vultrobjects.com";
const S3_REGION = "ams1";
const S3_BUCKET = "roguemouse-audit-log";

const DEFAULT_OPS_MODEL = "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16";
const envModel = process.env.VULTR_OPS_MODEL?.trim();
const OPS_MODEL =
  envModel && envModel.length > 0 ? envModel : DEFAULT_OPS_MODEL;

const SMOKE_PROMPT =
  "Describe the difference between implied volatility and realized volatility in two sentences.";

const RECORD_TYPE = "smoke_test:chat_completion";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Truncate a string to at most 500 characters per AC-32. If the input exceeds
 * 500 characters, return the first 500 followed by the literal suffix
 * `... [truncated; N chars total]` where N is the original character count.
 *
 * The suffix uses three ASCII periods (`.`, `.`, `.`), NOT the Unicode
 * horizontal ellipsis (`…`), per the spec amendment.
 */
function truncate500(input: string): string {
  if (input.length <= 500) {
    return input;
  }
  return input.slice(0, 500) + "... [truncated; " + input.length + " chars total]";
}

function failNoState(
  step: string,
  message: string,
  details: Record<string, unknown>,
): never {
  console.error("=== FAIL ===");
  console.error(`step    : ${step}`);
  console.error(`message : ${message}`);
  for (const [key, value] of Object.entries(details)) {
    console.error(`${key.padEnd(8)}: ${String(value)}`);
  }
  process.exit(1);
}

function failWithState(
  step: string,
  message: string,
  state: { key: string; hash: string; previousHash: string },
  details: Record<string, unknown>,
): never {
  console.error("=== FAIL ===");
  console.error(`step           : ${step}`);
  console.error(`message        : ${message}`);
  console.error(`s3 key         : ${state.key}  (PRESERVED — not deleted per AC-25)`);
  console.error(`writtenHash    : ${state.hash}`);
  console.error(`writtenPrevHash: ${state.previousHash}`);
  for (const [key, value] of Object.entries(details)) {
    const label = key.length > 15 ? key : key.padEnd(15);
    console.error(`${label}: ${String(value)}`);
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const totalStart = performance.now();
  const runId = randomUUID();

  console.log(`[smoke] runId : ${runId}`);
  console.log(`[smoke] model : ${OPS_MODEL}`);

  // --- Step 1: Inference ---
  const inferenceClient = createInferenceClient({
    apiKey: env.VULTR_INFERENCE_API_KEY,
    baseURL: INFERENCE_BASE_URL,
  });

  const inferenceStart = performance.now();
  const inferenceResult = await chatCompletion(inferenceClient, {
    model: OPS_MODEL,
    messages: [{ role: "user", content: SMOKE_PROMPT }],
    maxTokens: 500,
  });
  const inferenceMs = Math.round(performance.now() - inferenceStart);

  if (!inferenceResult.ok) {
    failNoState("inference", inferenceResult.error.message, {
      code: inferenceResult.error.code,
      retryable: inferenceResult.error.retryable,
    });
  }

  console.log(`[smoke] inference complete (${inferenceMs}ms)`);

  // --- Step 2: Build the payload. ---
  // Payload shape validation is no longer performed as a separate step:
  // after Sprint 3 Phase 4, the audit writer's internal `safeParse`
  // against the discriminated union (`auditRecordBodySchema`) covers
  // it. A shape error surfaces as `AppendResult` `{ ok: false, error:
  // { code: "validation_error", step: "validate", ... } }`, picked up
  // by the existing failure handler on the writer.append result.
  const payload = {
    model: inferenceResult.data.model,
    prompt: truncate500(SMOKE_PROMPT),
    response: truncate500(inferenceResult.data.content),
    tokens: {
      prompt: inferenceResult.usage.promptTokens,
      completion: inferenceResult.usage.completionTokens,
      total: inferenceResult.usage.totalTokens,
    },
    durationMs: inferenceMs,
  };

  // --- Step 3: Construct S3 client + writer ---
  const s3Client = createS3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  });

  const writer = new RunAuditWriter({
    s3Client,
    bucket: S3_BUCKET,
    runId,
    canonicalize,
    sha256Hex,
  });

  // --- Step 4: Append (S3 PUT) ---
  const putStart = performance.now();
  const appendResult = await writer.append({
    ts: new Date().toISOString(),
    recordType: RECORD_TYPE,
    payload,
  });
  const s3PutMs = Math.round(performance.now() - putStart);

  if (!appendResult.ok) {
    failNoState(appendResult.error.step ?? "s3_put", appendResult.error.message, {
      code: appendResult.error.code,
      retryable: appendResult.error.retryable,
    });
  }

  console.log(`[smoke] s3 put complete (${s3PutMs}ms)`);
  console.log(`[smoke] key   : ${appendResult.data.key}`);

  // --- Step 5: Read back (S3 GET) ---
  const getStart = performance.now();
  const readResult = await writer.read(appendResult.data.key);
  const s3GetMs = Math.round(performance.now() - getStart);

  if (!readResult.ok) {
    failWithState(
      readResult.error.step ?? "s3_get",
      readResult.error.message,
      appendResult.data,
      {
        code: readResult.error.code,
        retryable: readResult.error.retryable,
      },
    );
  }

  console.log(`[smoke] s3 get complete (${s3GetMs}ms)`);

  // --- Step 6: Verify round-trip integrity ---
  const verifyStart = performance.now();

  let recomputedCanonical: string;
  try {
    recomputedCanonical = canonicalize(readResult.data.parsed);
  } catch (err: unknown) {
    failWithState(
      "hash_verify",
      `re-canonicalization of read-back body threw: ${err instanceof Error ? err.message : String(err)}`,
      appendResult.data,
      {},
    );
  }

  const recomputedHash = sha256Hex(recomputedCanonical);

  if (recomputedHash !== appendResult.data.hash) {
    failWithState(
      "hash_mismatch",
      "round-trip hash mismatch — read-back body does not hash to the value captured at write time",
      appendResult.data,
      {
        expected: appendResult.data.hash,
        actual: recomputedHash,
        canonicalBeforeWrite: appendResult.data.canonicalJson,
        canonicalAfterRead: recomputedCanonical,
      },
    );
  }

  const parsedBody = readResult.data.parsed;
  const readPreviousHash =
    parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)
      ? (parsedBody as Record<string, unknown>).previousHash
      : undefined;

  if (readPreviousHash !== GENESIS_HASH) {
    failWithState(
      "prev_hash_mismatch",
      "read-back previousHash does not equal the genesis constant",
      appendResult.data,
      {
        expected: GENESIS_HASH,
        actual: typeof readPreviousHash === "string" ? readPreviousHash : "(missing or non-string)",
      },
    );
  }

  const hashVerifyMs = Math.round(performance.now() - verifyStart);

  // --- PASS ---
  const totalMs = Math.round(performance.now() - totalStart);

  console.log("");
  console.log("=== PASS ===");
  console.log(`runId           : ${runId}`);
  console.log(`s3 key          : ${appendResult.data.key}`);
  console.log(`recordHash      : ${appendResult.data.hash}`);
  console.log(`previousHash    : ${appendResult.data.previousHash}`);
  console.log(`matches genesis : ${appendResult.data.previousHash === GENESIS_HASH}`);
  console.log("");
  console.log(`promptTokens    : ${inferenceResult.usage.promptTokens}`);
  console.log(`completionTokens: ${inferenceResult.usage.completionTokens}`);
  console.log(`totalTokens     : ${inferenceResult.usage.totalTokens}`);
  console.log("");
  console.log(`inferenceMs     : ${inferenceMs}ms`);
  console.log(`s3PutMs         : ${s3PutMs}ms`);
  console.log(`s3GetMs         : ${s3GetMs}ms`);
  console.log(`hashVerifyMs    : ${hashVerifyMs}ms`);
  console.log(`totalMs         : ${totalMs}ms`);
  console.log("");
  console.log("Round-trip integrity verified.");
  console.log("previousHash matches the audit-log genesis.");
  console.log("Token usage recorded in audit payload.");

  process.exit(0);
}

main().catch((err: unknown) => {
  console.error("=== FAIL ===");
  console.error("step    : unexpected_top_level");
  console.error(`message : ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) {
    console.error("");
    console.error(err.stack);
  }
  process.exit(1);
});
