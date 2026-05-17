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
import { createDispatcher } from "@roguemouse/agent";
import {
  buildSearchIndex,
  loadRunbookCorpus,
} from "@roguemouse/runbooks";
import { canonicalize } from "@roguemouse/schemas";
import { loadScenarioA } from "@roguemouse/tools";

// ---------------------------------------------------------------------------
// Bootstrap: locate and load .env.local from the repo root.
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, "..");
const ENV_LOCAL_PATH = path.join(REPO_ROOT, ".env.local");

if (!existsSync(ENV_LOCAL_PATH)) {
  console.error("=== FAIL ===");
  console.error("step    : env_load");
  console.error(`message : .env.local not found at ${ENV_LOCAL_PATH}`);
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
// Env validation. Sprint 4b smoke is TOOL-ONLY — no LLM call paths. Only S3
// credentials are required. GEMINI_API_KEY / VULTR_INFERENCE_API_KEY are
// intentionally NOT consulted.
// ---------------------------------------------------------------------------

type RequiredEnv = {
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
};

const REQUIRED_VARS: ReadonlyArray<keyof RequiredEnv> = [
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
  process.exit(1);
}

const env = envAcc as RequiredEnv;

// ---------------------------------------------------------------------------
// Locked constants.
// ---------------------------------------------------------------------------

const S3_ENDPOINT = "https://ams1.vultrobjects.com";
const S3_REGION = "ams1";
const S3_BUCKET = "roguemouse-audit-log";

const RUNBOOK_CONTENT_DIR = path.join(REPO_ROOT, "packages", "runbooks", "content");

const SCENARIO_A_QUERY =
  "IV/RV ratio is 0.42 for AAPL at 09:31:14 UTC; the project's low-bound threshold is 0.45. Diagnose in 2-3 sentences.";

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

type PerToolTiming = { name: string; durationMs: number };

async function main(): Promise<void> {
  const startTotal = Date.now();
  const s3 = createS3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  });

  // -------------------------------------------------------------------------
  // 1. Construct writer for a fresh run. Constructor is local-only (no
  //    network); the run-id is generated up-front so the pre-flight check
  //    can route through the writer's own list method.
  // -------------------------------------------------------------------------
  const runId = randomUUID();
  const writer = new RunAuditWriter({
    s3Client: s3,
    bucket: S3_BUCKET,
    runId,
    canonicalize,
    sha256Hex,
  });

  // -------------------------------------------------------------------------
  // 2. Pre-flight List permission check via writer.list (limit=1, no
  //    prefix scope — i.e., a bucket-wide probe). A successful response
  //    proves ListBucket permission is granted on the access key.
  // -------------------------------------------------------------------------
  console.log("[pre-flight] verifying ListBucket permission via writer.list ...");
  const preflight = await writer.list({ limit: 1 });
  if (!preflight.ok) {
    const code = preflight.error.code;
    const msg = preflight.error.message;
    if (code === "AccessDenied" || code === "http_403" || /403/.test(msg)) {
      console.error("=== FAIL ===");
      console.error("step    : preflight_list_permission");
      console.error("message : ListBucket permission denied");
      console.error(`code    : ${code}`);
      console.error(`detail  : ${msg}`);
      console.error("remedy  : grant the access key ListBucket permission on roguemouse-audit-log");
      console.error("          via Vultr Object Storage settings; then re-run the smoke.");
      console.error("          Until granted, audit:search and chain verification cannot work.");
      process.exit(1);
    }
    console.error("=== FAIL ===");
    console.error("step    : preflight_list_permission");
    console.error(`code    : ${code}`);
    console.error(`message : ${msg}`);
    process.exit(1);
  }
  console.log(
    `[pre-flight] OK — bucket reachable, first-page count = ${preflight.data.keys.length}`,
  );

  // -------------------------------------------------------------------------
  // 3. Load fixtures.
  // -------------------------------------------------------------------------
  console.log("[boot] loading fixtures ...");
  const fixtures = await loadScenarioA(REPO_ROOT);
  console.log(`[boot] fixtures loaded (marketData symbols: ${Object.keys(fixtures.marketData).length}, positions: ${fixtures.positions.length})`);

  // -------------------------------------------------------------------------
  // 4. Load runbook corpus and build index.
  // -------------------------------------------------------------------------
  console.log("[boot] loading runbook corpus ...");
  const corpus = await loadRunbookCorpus(RUNBOOK_CONTENT_DIR);
  const runbookIndex = buildSearchIndex(corpus);
  console.log(`[boot] runbook index built (${corpus.length} runbooks)`);

  console.log(`[boot] writer constructed for runId=${runId}`);

  // -------------------------------------------------------------------------
  // 5. Write 1 synthetic anomaly:detected record directly via writer.append
  //    (NOT via dispatchTool — this is the smoke's setup-of-context step).
  // -------------------------------------------------------------------------
  const tAnomaly = Date.now();
  const anomalyWrite = await writer.append({
    ts: new Date().toISOString(),
    recordType: "anomaly:detected",
    payload: {
      anomalyType: "iv_rv_ratio_low_bound_breach",
      severity: 75,
      evidence: fixtures.anomalyEvidence,
      detectedAt: fixtures.anomalyEvidence.detectedAt,
    },
  });
  if (!anomalyWrite.ok) {
    console.error("=== FAIL ===");
    console.error("step    : anomaly_write");
    console.error(`code    : ${anomalyWrite.error.code}`);
    console.error(`message : ${anomalyWrite.error.message}`);
    process.exit(1);
  }
  console.log(`[step 1] anomaly:detected written (${Date.now() - tAnomaly}ms) hash=${anomalyWrite.data.hash.substring(0, 12)}...`);

  // -------------------------------------------------------------------------
  // 6. Construct dispatcher.
  // -------------------------------------------------------------------------
  const dispatchTool = createDispatcher({ writer, fixtures, runbookIndex });

  // -------------------------------------------------------------------------
  // 7. Three sequential dispatches.
  // -------------------------------------------------------------------------
  const perTool: PerToolTiming[] = [];

  const tMd = Date.now();
  const r1 = await dispatchTool("market_data:lookup", { symbol: "AAPL" });
  perTool.push({ name: "market_data:lookup", durationMs: Date.now() - tMd });
  if (!r1.ok) {
    console.error("=== FAIL ===");
    console.error("step    : dispatch_market_data_lookup");
    console.error(`code    : ${r1.error.code}`);
    console.error(`message : ${r1.error.message}`);
    process.exit(1);
  }
  console.log(`[step 2] market_data:lookup AAPL → spotPrice=${r1.data.spotPrice} (${perTool[perTool.length - 1]!.durationMs}ms)`);

  const tPs = Date.now();
  const r2 = await dispatchTool("position:snapshot", {});
  perTool.push({ name: "position:snapshot", durationMs: Date.now() - tPs });
  if (!r2.ok) {
    console.error("=== FAIL ===");
    console.error("step    : dispatch_position_snapshot");
    console.error(`code    : ${r2.error.code}`);
    console.error(`message : ${r2.error.message}`);
    process.exit(1);
  }
  console.log(`[step 3] position:snapshot → ${r2.data.positions.length} positions (${perTool[perTool.length - 1]!.durationMs}ms)`);

  const tRb = Date.now();
  const r3 = await dispatchTool("runbook:search", {
    query: SCENARIO_A_QUERY,
    topK: 3,
  });
  perTool.push({ name: "runbook:search", durationMs: Date.now() - tRb });
  if (!r3.ok) {
    console.error("=== FAIL ===");
    console.error("step    : dispatch_runbook_search");
    console.error(`code    : ${r3.error.code}`);
    console.error(`message : ${r3.error.message}`);
    process.exit(1);
  }
  const topMatch = r3.data.matches[0];
  console.log(`[step 4] runbook:search → ${r3.data.matches.length} matches, top=${topMatch ? path.basename(topMatch.path) + " (score " + topMatch.relevanceScore + ")" : "none"} (${perTool[perTool.length - 1]!.durationMs}ms)`);

  // -------------------------------------------------------------------------
  // 8. List all records for this run.
  // -------------------------------------------------------------------------
  console.log("[verify] listing records for this run ...");
  const listResult = await writer.list({ runIdPrefix: runId, limit: 100 });
  if (!listResult.ok) {
    console.error("=== FAIL ===");
    console.error("step    : list_for_verification");
    console.error(`code    : ${listResult.error.code}`);
    console.error(`message : ${listResult.error.message}`);
    process.exit(1);
  }
  console.log(`[verify] listed ${listResult.data.keys.length} records (hasMore=${listResult.data.hasMore})`);

  if (listResult.data.keys.length < 7) {
    console.error("=== FAIL ===");
    console.error("step    : record_count");
    console.error(`message : expected at least 7 records (1 anomaly + 6 tool-flow), got ${listResult.data.keys.length}`);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // 9. Read each record in lex-sorted key order (within one runId, lex sort
  //    matches chronological order because the ts-safe portion is
  //    fixed-width ISO-8601). Verify chain integrity end-to-end.
  // -------------------------------------------------------------------------
  const sortedKeys = [...listResult.data.keys].sort();
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < sortedKeys.length; i++) {
    const key = sortedKeys[i]!;
    const readResult = await writer.read(key);
    if (!readResult.ok) {
      console.error("=== FAIL ===");
      console.error("step    : chain_read");
      console.error(`key     : ${key}`);
      console.error(`code    : ${readResult.error.code}`);
      console.error(`message : ${readResult.error.message}`);
      process.exit(1);
    }
    const record = readResult.data.parsed as { previousHash?: unknown };
    if (typeof record.previousHash !== "string") {
      console.error("=== FAIL ===");
      console.error("step    : chain_integrity");
      console.error(`key     : ${key}`);
      console.error("message : record is missing a string previousHash field");
      process.exit(1);
    }
    if (record.previousHash !== prevHash) {
      console.error("=== FAIL ===");
      console.error("step    : chain_integrity");
      console.error(`key     : ${key}`);
      console.error(`expected: ${prevHash}`);
      console.error(`actual  : ${record.previousHash}`);
      console.error(`index   : ${i} of ${sortedKeys.length}`);
      process.exit(1);
    }
    // Recompute this record's hash from its canonical form for the
    // next iteration. The writer.read body is the raw S3 object bytes
    // (which were the canonical JSON at write time), but to be safe
    // we re-canonicalize the parsed value through the same function
    // the writer used.
    const canonical = canonicalize(readResult.data.parsed);
    prevHash = sha256Hex(canonical);
  }

  // -------------------------------------------------------------------------
  // 10. Structured PASS report.
  // -------------------------------------------------------------------------
  const totalElapsedMs = Date.now() - startTotal;
  console.log("");
  console.log("=== PASS ===");
  console.log(
    JSON.stringify(
      {
        runId,
        recordCount: sortedKeys.length,
        finalHash: prevHash,
        genesisHash: GENESIS_HASH,
        totalElapsedMs,
        perTool,
        firstKey: sortedKeys[0],
        lastKey: sortedKeys[sortedKeys.length - 1],
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("=== FAIL ===");
  console.error("step    : uncaught");
  console.error(`message : ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
