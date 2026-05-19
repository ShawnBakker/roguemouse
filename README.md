# Roguemouse

> AI Operations Officer for algorithmic trading platforms.
> External governance layer with cryptographically verifiable audit chains.
> Built for the AI Agent Olympics Hackathon at Milan AI Week 2026.

**Live demo**: http://95-179-138-253.sslip.io
**License**: [MIT](LICENSE)

---

## What this is

Most AI agents you hear about in finance are *traders* — they aim to alpha,
beat a benchmark, predict the next price. Roguemouse is the opposite. It is
**the layer that makes any autonomous trader accountable to a human and to a
regulator**.

The pitch in one line: when something looks wrong on a trading platform, three
specialized AI voices debate the situation, reconcile their disagreements, and
emit a single proposed action — or explicitly refuse to act — with every step
of their reasoning cryptographically chained to a tamper-evident audit log.

Roguemouse never places a trade. It produces *governance artifacts*: structured
reasoning, dissent traces, refusal records, and a verifiable hash chain that
anyone (including a regulator) can audit in their browser without trusting our
servers.

## How it works

When an anomaly is detected on the trading system — an IV/RV ratio outside its
historical band, a position-broker reconciliation gap, a stale market-data
surface — Roguemouse kicks off a multi-agent debate:

1. **Anomaly detection** finds the breach and writes the first audit record.
2. **Risk Officer** (Gemini 2.5 Flash) reasons over the anomaly from a
   risk-management perspective — calls for market data, searches the runbook
   corpus, flags data freshness or model disagreement, writes a reasoning
   record.
3. **Ops Engineer** (NVIDIA Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16 via
   Vultr Serverless Inference) reasons from a systems-and-data perspective —
   snapshots positions, reconciles with the broker, searches prior audit
   records, writes a reasoning record.
4. **Synthesizer** (Gemini 2.5 Flash) reads both perspectives and emits a
   structured JSON verdict: a `synthesizer:proposal` with supporting
   evidence and confidence score, or a `synthesizer:refusal` with a reason
   code and the inputs that were degraded.

Every tool call, every voice's reasoning, and the terminal disposition are
hashed and chained — 15 records per typical run, root-anchored at a fixed
genesis hash.

The system **refuses to act when its inputs are degraded**. A single failed
upstream call (a 503 from one of the LLM providers, for example) produces a
refusal record with the captured error in the chain, not a confident
hallucinated decision. The audit log makes this refusal cryptographically
verifiable: judges can see *that* the agent refused, *why* it refused, and
*when*.

## Cryptographic audit chain

The audit log is a hash chain rooted at a fixed genesis:

```
GENESIS = sha256("roguemouse-audit-genesis-v1")
        = b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc
```

Each record is a 5-field envelope:

```
{ ts, runId, recordType, previousHash, payload }
```

The body is canonicalized (recursive lexicographic key sort, no whitespace,
integers in the safe range only) and SHA-256'd. That hash becomes the next
record's `previousHash`. Records are stored in Vultr Object Storage with the
hash embedded in the S3 object key, so the storage layer's filename
uniqueness is itself a chain-integrity check.

**You can verify it in your browser without trusting our server.** Open any
run's detail page on the live URL, click *Verify chain (15 records)*. The
client re-canonicalizes each record, recomputes its SHA-256 (via pure-JS
`js-sha256`, not Web Crypto — see *Honest limitations* below), and confirms
the chain from genesis to terminal disposition. No server call, no API key,
no trust assumption beyond *the JavaScript you can read in DevTools is doing
what it says*.

## Try it yourself

Visit **http://95-179-138-253.sslip.io**.

What you can do:

- **Watch the canonical replay.** The landing page paces through a real
  15-record audit chain over ~33 seconds, one record at a time. The terminal
  disposition card at the top shows the synthesizer's verdict before the
  detail unfolds.
- **Toggle clean vs. degraded.** Two canonical Sprint 4c runs are pinned —
  one with clean fixtures (the agent recommends a data-freshness
  investigation), one with semantically uncertain inputs (the agent
  integrates the additional broker-reconciliation evidence into a more
  detailed recommendation).
- **Trigger your own live run.** Pick any ticker symbol (e.g., `TSLA`,
  `BTC-USD`, `MSFT`). The agent reasons about your symbol against the same
  synthetic IV/RV anomaly pattern, produces a fresh 15-record chain rooted
  at genesis, and writes it to Vultr Object Storage in real time.
  - First trigger per browser session is gated by a cookie — click *Reset
    session* to fire another.
- **Browse the audit log.** All runs ever minted by Roguemouse (Sprints
  2–6 included) live under `/audit`. Click any run to see the full chain.
- **Verify any chain.** *Verify chain* button on each detail page.
  Cryptographic ground truth, in-browser.

Canonical runs pinned for replay:

- Clean: `cfbafd8c-47f9-4dbc-8c5a-dc55a6b08577` (15 records, decision
  proposal, confidence 9000 bp, 33.3s)
- Degraded: `381dd171-68d4-427a-af59-b4af704768b9` (15 records, decision
  proposal, confidence 9200 bp, 30.6s)

## Architecture

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15 App Router, React 19, TypeScript 5.6 |
| UI primitives | shadcn/ui 2.7 + Tailwind CSS v3 (Meridian editorial theme) |
| Risk Officer voice | Gemini 2.5 Flash (Google AI Studio, OpenAI-compat endpoint) |
| Ops Engineer voice | NVIDIA Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16 via **Vultr Serverless Inference** |
| Synthesizer voice | Gemini 2.5 Flash (structured-JSON `response_format`) |
| Audit storage | **Vultr Object Storage** (S3-compatible, bucket `roguemouse-audit-log`, region `ams1`) |
| Audit chain | Application-layer SHA-256 hash chain, RFC-8785-style canonical JSON |
| Client-side verification | `js-sha256` (pure-JS) + Web Crypto's `crypto.subtle` fallback for HTTPS contexts |
| Deployment | **Vultr Cloud Compute** VPS (2 vCPU / 4 GB / Ubuntu 22.04, Amsterdam), Coolify-managed |
| CI/CD | GitHub Actions → ghcr.io → Coolify deploy webhook (image-only push to prod, no SSH-in-CI) |
| Validation | Zod 3 (all schemas), Vitest (327 baseline tests) |
| Package management | pnpm 10.27 workspaces (no Turborepo) |

### The three Vultr surfaces

Roguemouse uses three distinct Vultr products:

1. **Vultr Serverless Inference** powers the Ops Engineer voice. We pinned
   `nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16` for systems
   diagnosis — its reasoning style is a strong complement to Gemini Flash
   on the Risk Officer side.
2. **Vultr Object Storage** is the audit log's system of record. We use a
   single bucket (`roguemouse-audit-log`) with content-addressed object
   keys (`audit/{runId}/{ts-safe}-{hash}.json`). Vultr Object Storage does
   not support S3 Object Lock, so tamper-evidence is enforced at the
   application layer via the hash chain (see *Honest limitations*).
3. **Vultr Cloud Compute** hosts the live deployment. The Next.js standalone
   bundle runs in a Docker container managed by Coolify; GitHub Actions
   builds and pushes images to ghcr.io, then fires a Coolify webhook for
   zero-touch redeploy.

## Repo structure

```
apps/web/                      Next.js app (frontend + API routes)
  src/app/                       routes: /, /audit, /audit/[runId], /api/scenario, /api/session/reset
  src/components/                shadcn + Meridian-themed UI primitives
  src/lib/                       bucket reader, session gate, canonical-run constants

packages/
  schemas/                     Zod schemas — 12 audit record types, 8 agent tools, canonicalize()
  audit/                       RunAuditWriter (Vultr Object Storage), GENESIS_HASH, sha256Hex
  inference/                   OpenAI SDK wrappers for Gemini + Vultr Inference, error classifier
  agent/                       runScenarioA orchestrator, 3 voices, anomaly detector, dispatcher
  tools/                       8 tool implementations, Scenario A fixture loader
  runbooks/                    application-layer RAG over a synthetic runbook corpus
  broker-mock/                 deterministic fixture replay (no live brokerage anywhere)

fixtures/scenario-a/           4-file fixture set: market data, positions, broker positions, anomaly evidence
fixtures/scenario-a-degraded/  semantically-uncertain variant for demo refusal narrative
scripts/                       smoke tests + offline chain verifier (verify-chain-offline.ts)
docs/sprints/                  per-sprint brainstorm / spec / plan / review
.claude/                       Claude Code workflow scaffolding (5-stage protocol, rules, commands)
```

## Honest limitations

These are real limitations of the demo deployment, not future-tense aspirations.
Disclosure beats discovery.

- **Production runs on HTTP, not HTTPS.** The sslip.io wildcard-DNS service
  hit a Let's Encrypt rate limit during deployment, and the hackathon budget
  didn't include a registered domain. The trade-off is that `window.crypto.subtle`
  is gated to secure contexts by the W3C Web Crypto spec § 1.4, so the
  client-side chain verifier uses `js-sha256` (a pure-JS SHA-256, MIT-licensed,
  ~6 KB minified) instead. Hash output is byte-identical (cross-validated
  against Node's `node:crypto` and `webcrypto.subtle` in
  `scripts/verify-chain-offline.ts`).

- **Application-layer audit integrity, not WORM.** Vultr Object Storage is
  S3-API-compatible but does *not* support `ObjectLockConfiguration`. There
  is no bucket-level immutability, no versioning, no SSE. Our SHA-256 hash
  chain provides tamper-evidence at the application layer: any modified
  record produces a hash that no longer matches the next record's
  `previousHash`, and the chain is verifiable client-side without server
  trust. This is the honest architecture for the available storage primitive.

- **In-memory session state.** The cookie-gated trigger (one live run per
  browser session) is enforced via an in-memory `Map` in `sessionGate.ts`
  and an HTTP-only UUID cookie. Container restart resets the Map; production
  would back this with Redis or a small persistent store. The *Reset session*
  button on the landing page exists specifically because of this trade-off.

- **Synthetic fixture data.** The "anomaly" the agent reasons about is
  synthesized for the demo — the market-data and position fixtures live in
  `fixtures/scenario-a/`. A production deployment would integrate with the
  firm's existing anomaly-detection pipeline; the agent loop, audit chain,
  and verification surface are unchanged. The user-supplied symbol in the
  *Try your own* trigger simply relabels these synthetic fixtures — the
  underlying IV/RV breach numbers stay the same.

- **No live trading. No real money.** The "broker" is a deterministic mock
  that replays seeded fixtures. Every demo run produces identical results
  given identical seeds. No live brokerage account is connected.

## Development

Quick setup if you want to clone and run locally:

```bash
# Prerequisites: pnpm 10.27+, Node 20 LTS
git clone https://github.com/ShawnBakker/roguemouse.git
cd roguemouse
pnpm install

# Create .env.local at the repo root with these four required vars:
#   S3_ACCESS_KEY=<your Vultr Object Storage access key>
#   S3_SECRET_KEY=<your Vultr Object Storage secret key>
#   GEMINI_API_KEY=<your Google AI Studio API key>
#   VULTR_INFERENCE_API_KEY=<your Vultr Inference API key>

# Type-check, build, test
pnpm -r typecheck
pnpm -r build
pnpm -r test

# Run the web app locally
pnpm --filter @roguemouse/web dev   # http://localhost:3000

# Fire a real Scenario A run from the command line (writes 15 records to your bucket)
pnpm scenario:a
pnpm scenario:a -- --degraded

# Verify any audit chain offline (mirrors the browser verifier's protocol)
pnpm tsx scripts/verify-chain-offline.ts <runId>
```

The audit log is bucket-scoped, so any runs you mint locally land in *your*
bucket (configured via `S3_ACCESS_KEY` / `S3_SECRET_KEY`). The pinned canonical
runs above (`cfbafd8c…` and `381dd171…`) live in the project's demo bucket and
are read by the public `/audit` browser.

## Built for Milan AI Week 2026

Build window: Wednesday May 13 – Tuesday May 19, 2026.

Sprint summary:

- **Sprint 0**: Vultr resource provisioning (Object Storage, Serverless
  Inference, VPS).
- **Sprint 1**: Workspace scaffolding (8 packages, Next.js app, pnpm).
- **Sprint 2**: First end-to-end smoke test against real Vultr — first audit
  record minted, genesis chain anchored.
- **Sprint 3**: Tool schema lock — 12 audit recordType branches, 8 agent
  tools, canonicalize relocation, primitives module.
- **Sprint 4a**: Gemini integration smoke test, third audit record.
- **Sprint 4b**: dispatchTool runtime + 8 tool implementations + RAG, first
  multi-record chain (7 records).
- **Sprint 4c**: Scenario A — multi-agent debate orchestrator. The canonical
  clean + degraded runs above were minted in this sprint.
- **Sprint 6**: Vultr VPS deployment, Coolify push-to-deploy pipeline, the
  full web UI (routes, components, audit browser, chain verifier),
  user-supplied symbol input, session reset.

Total ~12,000 lines of TypeScript across 8 packages, 327 tests, zero code
from prior projects, all dependencies MIT/Apache-2.0/BSD.
