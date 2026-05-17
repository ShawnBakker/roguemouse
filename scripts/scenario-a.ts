// 1. Node built-ins
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 2. Third-party
import { config as loadDotenv } from "dotenv";

// 3. Workspace
import {
  RunAuditWriter,
  createS3Client,
  sha256Hex,
} from "@roguemouse/audit";
import { runScenarioA } from "@roguemouse/agent";
import {
  createGeminiClient,
  createInferenceClient,
} from "@roguemouse/inference";
import {
  buildSearchIndex,
  loadRunbookCorpus,
} from "@roguemouse/runbooks";
import { canonicalize } from "@roguemouse/schemas";
import { loadScenarioA } from "@roguemouse/tools";

// ---------------------------------------------------------------------------
// Bootstrap.
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
  console.error(
    `message : Failed to parse ${ENV_LOCAL_PATH}: ${dotenvResult.error.message}`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Env validation. Sprint 4c needs all four credentials: S3 (for audit
// writes), Gemini (Risk Officer + Synthesizer voices), Vultr Inference
// (Ops Engineer voice).
// ---------------------------------------------------------------------------

type RequiredEnv = {
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
  GEMINI_API_KEY: string;
  VULTR_INFERENCE_API_KEY: string;
};

const REQUIRED_VARS: ReadonlyArray<keyof RequiredEnv> = [
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "GEMINI_API_KEY",
  "VULTR_INFERENCE_API_KEY",
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
// CLI flag parsing.
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const degraded = args.includes("--degraded");

const FIXTURE_SUBDIR = degraded
  ? path.join("fixtures", "scenario-a-degraded")
  : path.join("fixtures", "scenario-a");

// ---------------------------------------------------------------------------
// Locked constants. Three per-voice model overrides per Amendment 3 of
// the Sprint 4c plan.
// ---------------------------------------------------------------------------

const S3_ENDPOINT = "https://ams1.vultrobjects.com";
const S3_REGION = "ams1";
const S3_BUCKET = "roguemouse-audit-log";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const VULTR_BASE_URL = "https://api.vultrinference.com/v1";

const DEFAULT_GEMINI_RISK_MODEL = "gemini-2.5-flash";
const DEFAULT_GEMINI_SYNTH_MODEL = "gemini-2.5-flash";
const DEFAULT_VULTR_OPS_MODEL = "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16";

const GEMINI_RISK_MODEL =
  process.env.GEMINI_RISK_MODEL?.trim() || DEFAULT_GEMINI_RISK_MODEL;
const GEMINI_SYNTH_MODEL =
  process.env.GEMINI_SYNTH_MODEL?.trim() || DEFAULT_GEMINI_SYNTH_MODEL;
const VULTR_OPS_MODEL =
  process.env.VULTR_OPS_MODEL?.trim() || DEFAULT_VULTR_OPS_MODEL;

const RUNBOOK_CONTENT_DIR = path.join(
  REPO_ROOT,
  "packages",
  "runbooks",
  "content",
);

// ---------------------------------------------------------------------------
// NOTE on model selection: Sprint 4c uses two Gemini clients (one for
// each Gemini voice, since they may rotate models independently) and
// one Vultr Inference client. Currently both Gemini voices use the same
// underlying client + model, but constructing them separately keeps the
// abstraction clean if Sprint 7 polish wants to upgrade voices
// independently (e.g., Synthesizer to gemini-2.5-pro if billing is
// enabled).
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const startTotal = Date.now();

  // -------------------------------------------------------------------------
  // 1. Construct S3 client + writer.
  // -------------------------------------------------------------------------
  const s3 = createS3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  });
  const runId = randomUUID();
  const writer = new RunAuditWriter({
    s3Client: s3,
    bucket: S3_BUCKET,
    runId,
    canonicalize,
    sha256Hex,
  });

  // -------------------------------------------------------------------------
  // 2. Construct Gemini + Vultr Inference clients.
  // -------------------------------------------------------------------------
  const geminiClient = createGeminiClient({
    apiKey: env.GEMINI_API_KEY,
    baseURL: GEMINI_BASE_URL,
  });
  const vultrClient = createInferenceClient({
    apiKey: env.VULTR_INFERENCE_API_KEY,
    baseURL: VULTR_BASE_URL,
  });

  // -------------------------------------------------------------------------
  // 3. Load fixtures (clean or degraded) + runbook corpus.
  // -------------------------------------------------------------------------
  console.log(`[boot] variant: ${degraded ? "degraded" : "clean"}`);
  console.log(`[boot] fixture subdir: ${FIXTURE_SUBDIR}`);
  console.log(`[boot] runId: ${runId}`);
  console.log(
    `[boot] models: risk=${GEMINI_RISK_MODEL} synth=${GEMINI_SYNTH_MODEL} vultr=${VULTR_OPS_MODEL}`,
  );

  const fixtures = await loadScenarioA(REPO_ROOT, FIXTURE_SUBDIR);
  console.log(
    `[boot] fixtures loaded (marketData symbols: ${Object.keys(fixtures.marketData).length}, positions: ${fixtures.positions.length}, brokerPositions: ${fixtures.brokerPositions.length})`,
  );

  const corpus = await loadRunbookCorpus(RUNBOOK_CONTENT_DIR);
  const runbookIndex = buildSearchIndex(corpus);
  console.log(`[boot] runbook index built (${corpus.length} runbooks)`);

  // -------------------------------------------------------------------------
  // 4. Invoke the orchestrator. Sprint 4c uses a single Gemini client +
  //    model for both Gemini voices today; if Sprint 7 polish splits
  //    them, the orchestrator's RunScenarioAArgs can be extended (the
  //    current shape uses one gemini.{client, model} pair). The
  //    GEMINI_SYNTH_MODEL env override is captured for future use; for
  //    now the orchestrator uses gemini.model for both Risk and Synth.
  // -------------------------------------------------------------------------
  if (GEMINI_RISK_MODEL !== GEMINI_SYNTH_MODEL) {
    console.warn(
      `[warn] GEMINI_RISK_MODEL (${GEMINI_RISK_MODEL}) differs from GEMINI_SYNTH_MODEL (${GEMINI_SYNTH_MODEL}); current orchestrator uses GEMINI_RISK_MODEL for both voices. Per-voice client routing is a Sprint 7 polish item.`,
    );
  }

  const result = await runScenarioA({
    writer,
    runId,
    fixtures,
    runbookIndex,
    gemini: { client: geminiClient, model: GEMINI_RISK_MODEL },
    vultr: { client: vultrClient, model: VULTR_OPS_MODEL },
  });

  // -------------------------------------------------------------------------
  // 5. Structured PASS report. Both decision branches (proposal AND
  //    refusal) are PASS outcomes — refusal is a legitimate terminal
  //    state per spec AC-22.
  // -------------------------------------------------------------------------
  const totalElapsedMs = Date.now() - startTotal;
  console.log("");
  console.log("=== PASS ===");
  console.log(
    JSON.stringify(
      {
        variant: degraded ? "degraded" : "clean",
        runId: result.runId,
        recordCount: result.recordCount,
        finalHash: result.finalHash,
        decision: result.decision,
        confidence_bp: result.confidence_bp,
        totalElapsedMs,
        scenarioElapsedMs: result.totalElapsedMs,
        perVoice: result.perVoice,
        perTool: result.perTool,
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
  console.error(
    `message : ${err instanceof Error ? err.stack : String(err)}`,
  );
  process.exit(1);
});
