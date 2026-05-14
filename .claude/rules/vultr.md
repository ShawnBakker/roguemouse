# Vultr rules

These rules encode hard-won knowledge about Vultr's specific implementation of S3 and OpenAI-compatible APIs. Most are gotchas where Vultr deviates from the reference implementation. Reading the Vultr docs is not sufficient; these rules are derived from actual integration experience.

## Vultr Object Storage

### Endpoint and region

- **Region**: `ams1` (Amsterdam). All Vultr resources for Roguemouse are in this region.
- **Endpoint**: `https://ams1.vultrobjects.com`
- **Bucket**: `roguemouse-audit-log`

### S3 compatibility caveats

Vultr Object Storage is S3-API-compatible but with specific limitations. These have informed our architecture; do not work around them.

1. **No Object Lock (WORM).** S3's `ObjectLockConfiguration` is not supported. We cannot enforce immutability at the bucket level.
   **Mitigation**: SHA-256 hash chain in the audit log. Every record stores the SHA-256 of the prior record as `previousHash`. Tampering is detectable by verifying the chain.

2. **No versioning.** Bucket versioning is not supported.
   **Mitigation**: Content-addressed keys. Every audit record's object key is its own SHA-256 hash. Writing the same content twice is idempotent (same key); writing different content produces a different key.

3. **No server-side encryption (SSE).** `SSE-S3`, `SSE-KMS`, `SSE-C` are not supported.
   **Mitigation**: For Roguemouse's synthetic demo data, this is acceptable. For production fintech use, client-side encryption would be required and is out of scope.

4. **No bucket notifications / webhooks.** Cannot trigger downstream events when an object lands.
   **Mitigation**: Application polls or writes events to a separate channel (in our case, the UI polls the audit log directly).

5. **5 GB object size cap.** Multipart uploads are supported but capped.
   **Mitigation**: Audit records are small (KB-sized JSON). No multipart needed.

6. **Content-Length header may not match actual file size on download.** Files are gzip-compressed by Vultr, and `Content-Length` reflects compressed size while the body delivers decompressed data.
   **Mitigation**: For JSON writes, use the AWS SDK's default handling. Don't manually parse `Content-Length`.

### Required SDK configuration

```typescript
import { S3Client } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  endpoint: "https://ams1.vultrobjects.com",
  region: "ams1",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
  forcePathStyle: false,  // virtual-hosted style works; path style also works
});
```

### Audit record write protocol

Every write to the audit log MUST follow this protocol:

1. **Read the latest record's hash** to use as `previousHash`. Maintain in-memory state if possible to avoid a round-trip; otherwise fetch the last object and verify.
2. **Canonicalize the JSON** (sorted keys, no whitespace) before hashing. The canonical form is what gets hashed, not the pretty-printed form.
3. **Compute the SHA-256** of the canonical JSON.
4. **Use the SHA-256 as the object key**: `audit/[runId]/[timestamp]-[hash].json`.
5. **Write the canonical JSON as the object body.**
6. **Update in-memory state** so the next write's `previousHash` is this hash.

Pseudocode:

```typescript
async function appendAuditRecord(record: AuditRecord, runId: string): Promise<string> {
  const withChain = {
    ...record,
    previousHash: lastHashForRun(runId) ?? GENESIS_HASH,
  };
  const canonical = canonicalize(withChain);  // sorted keys, no whitespace
  const hash = sha256(canonical);
  const key = `audit/${runId}/${record.ts}-${hash}.json`;

  await s3.send(new PutObjectCommand({
    Bucket: "roguemouse-audit-log",
    Key: key,
    Body: canonical,
    ContentType: "application/json",
    Metadata: { sha256: hash, previousHash: withChain.previousHash },
  }));

  recordHashForRun(runId, hash);
  return hash;
}
```

**Never overwrite an existing audit record.** Object keys are content-addressed; writing the same record twice is a no-op. Writing a modified version produces a different key, leaving the original intact.

## Vultr Serverless Inference

### Endpoint

- **Base URL**: `https://api.vultrinference.com/v1`
- **API key**: Bearer token from `VULTR_INFERENCE_API_KEY` env var.

### OpenAI compatibility

The endpoint is OpenAI-compatible. Use the official `openai` npm package with a custom `baseURL`:

```typescript
import { OpenAI } from "openai";

const client = new OpenAI({
  apiKey: process.env.VULTR_INFERENCE_API_KEY!,
  baseURL: "https://api.vultrinference.com/v1",
});
```

### Model selection

- **Ops Engineer voice**: `nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16`
  - 262K context window
  - $0.13/M input tokens, $0.38/M output tokens
  - NVIDIA Nemotron reasoning model, BF16 precision
  - Verified working as of May 13, 2026

- **Fallback if Nemotron rotates out**: `nvidia/Nemotron-Cascade-2-30B-A3B` (general-purpose Nemotron, same pricing tier)

Model names rotate. Pin the model string in `.env.local` and `ROGUEMOUSE_CONTEXT.md`. Verify availability at session start by hitting `GET /v1/models`.

### Tool / function calling

Native function calling per the OpenAI spec is **not** supported on most Vultr models (only `kimi-k2-instruct` supports it). Our architecture orchestrates tools from the planner code (Node.js), not from the LLM. LLMs receive tool results as context and produce reasoning text — they do not directly invoke tools.

**Do not** design new features that rely on LLM-side function calling. If a feature needs an LLM to "call a tool," restructure so that the planner code calls the tool, includes the result in the next prompt, and asks the LLM to reason over it.

### RAG endpoint

Vultr offers `POST /v1/chat/completions/RAG` for retrieval-augmented generation. **We do not use it.** Reasons:

1. RAG model compatibility is a moving target. The compatible-model list rotates with each catalog update.
2. We need full control over chunk ranking, formatting, and citation injection.
3. Application-layer RAG is portable — we can swap models or providers without breaking the retrieval layer.

Our pattern: hit the Vector Store search endpoint to get top-k chunks, then inject those chunks into the system prompt of a standard `/v1/chat/completions` call.

### Circuit breakers required

All LLM calls must be wrapped in a circuit breaker (`opossum` or similar). Configuration:

- **Timeout**: 30s per call
- **Error threshold**: 50% errors over 10 calls trips the breaker
- **Reset timeout**: 60s before retrying after trip
- **Fallback**: return a structured error envelope, never throw

When the breaker is open for the Risk Officer voice, the planner **refuses to propose**. A degraded agent that proposes from incomplete reasoning is worse than no agent. This refusal is a feature, not a bug — it's the answer to the judge question "what if the AI is wrong?"

### Cost tracking

Token usage is reported in every chat completion response under `usage`. Log `prompt_tokens`, `completion_tokens`, and `total_tokens` per call. The audit record includes a `cost_estimate` field computed from these counts and the model's pricing.

## Vultr Cloud Compute VPS

- **IP**: `95.179.138.253`
- **Hostname**: `roguemouse-vps`
- **OS**: Ubuntu 22.04.5 LTS x64
- **Specs**: 2 vCPU shared / 4 GB RAM / 80 GB SSD
- **SSH**: `ssh -i ~/.ssh/id_ed25519_roguemouse root@95.179.138.253`

### Build constraint

Next.js builds are memory-hungry. The VPS has 4 GB which is borderline for `npm install + next build`. **Build the Docker image in GitHub Actions, not on the VPS.** The VPS only pulls and runs pre-built images.

### Coolify (deployment manager)

To be installed Day 2. Coolify provides Docker Compose orchestration, reverse proxy, TLS certs, and GitHub-webhook deployment. If Coolify proves troublesome, fall back to plain Docker Compose + Caddy reverse proxy.

### Firewall

Default Vultr firewall allows SSH (22) and not much else. When the app deploys, we'll need to open ports 80 (HTTP) and 443 (HTTPS) via either Vultr's firewall UI or Ubuntu's `ufw`.
