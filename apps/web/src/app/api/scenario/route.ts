import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

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

import {
  getOrCreateSessionId,
  hasTriggered,
  markTriggered,
  getTriggeredRunId,
} from "@/lib/sessionGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const S3_ENDPOINT = "https://ams1.vultrobjects.com";
const S3_REGION = "ams1";
const S3_BUCKET = "roguemouse-audit-log";

const GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/";
const VULTR_BASE_URL = "https://api.vultrinference.com/v1";

const DEFAULT_GEMINI_RISK_MODEL = "gemini-2.5-flash";
const DEFAULT_VULTR_OPS_MODEL =
  "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16";

function resolveDataRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "fixtures", "scenario-a"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not locate data root (fixtures/scenario-a) walking up from ${process.cwd()}`,
  );
}

type RequiredEnv = {
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
  GEMINI_API_KEY: string;
  VULTR_INFERENCE_API_KEY: string;
};

function readRequiredEnv(): RequiredEnv | { missing: string[] } {
  const names: ReadonlyArray<keyof RequiredEnv> = [
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "GEMINI_API_KEY",
    "VULTR_INFERENCE_API_KEY",
  ];
  const acc: Partial<RequiredEnv> = {};
  const missing: string[] = [];
  for (const name of names) {
    const v = process.env[name];
    if (!v || v.trim().length === 0) missing.push(name);
    else acc[name] = v;
  }
  return missing.length > 0 ? { missing } : (acc as RequiredEnv);
}

export async function POST(): Promise<Response> {
  const { sessionId } = await getOrCreateSessionId();

  if (hasTriggered(sessionId)) {
    const existing = getTriggeredRunId(sessionId);
    return Response.json(
      {
        ok: false,
        error: {
          code: "session_already_triggered",
          message:
            "This browser session has already triggered a run. Open a fresh browser to trigger another.",
          existingRunId: existing,
        },
      },
      { status: 429 },
    );
  }

  const env = readRequiredEnv();
  if ("missing" in env) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "env_missing",
          message: `Server is missing required env: ${env.missing.join(", ")}`,
        },
      },
      { status: 500 },
    );
  }

  let dataRoot: string;
  try {
    dataRoot = resolveDataRoot();
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "data_root_missing",
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 500 },
    );
  }

  const runId = randomUUID();
  markTriggered(sessionId, runId);

  try {
    const s3 = createS3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    });
    const writer = new RunAuditWriter({
      s3Client: s3,
      bucket: S3_BUCKET,
      runId,
      canonicalize,
      sha256Hex,
    });

    const gemini = createGeminiClient({
      apiKey: env.GEMINI_API_KEY,
      baseURL: GEMINI_BASE_URL,
    });
    const vultr = createInferenceClient({
      apiKey: env.VULTR_INFERENCE_API_KEY,
      baseURL: VULTR_BASE_URL,
    });

    const geminiModel =
      process.env.GEMINI_RISK_MODEL?.trim() || DEFAULT_GEMINI_RISK_MODEL;
    const vultrModel =
      process.env.VULTR_OPS_MODEL?.trim() || DEFAULT_VULTR_OPS_MODEL;

    const fixtures = await loadScenarioA(dataRoot, "fixtures/scenario-a");
    const corpus = await loadRunbookCorpus(
      path.join(dataRoot, "packages/runbooks/content"),
    );
    const runbookIndex = buildSearchIndex(corpus);

    const result = await runScenarioA({
      writer,
      runId,
      fixtures,
      runbookIndex,
      gemini: { client: gemini, model: geminiModel },
      vultr: { client: vultr, model: vultrModel },
    });

    return Response.json({
      ok: true,
      runId: result.runId,
      recordCount: result.recordCount,
      decision: result.decision,
      confidenceBp: result.confidence_bp,
      totalElapsedMs: result.totalElapsedMs,
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "scenario_failed",
          message: err instanceof Error ? err.message : String(err),
          runId,
        },
      },
      { status: 500 },
    );
  }
}
