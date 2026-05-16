# Roguemouse Context (Ground Truth)

This file is the canonical state of the project. **Update it whenever state changes.** It is read at every session start.

**Last updated**: 2026-05-16
**Current sprint**: Sprint 4b — dispatchTool runtime + 8 tool implementations + RAG (about to start)

---

## Project identity

- **Name**: Roguemouse
- **One-liner**: AI Operations Officer for algorithmic trading platforms
- **Hackathon**: AI Agent Olympics · Milan AI Week 2026
- **Submission deadline**: 17:00 CEST · Tuesday May 19, 2026
- **License**: MIT
- **Repo**: `https://github.com/ShawnBakker/roguemouse`

## Team

- **Lead engineer**: Shawn (uses Claude Code)
- **Teammate**: Junior developer (uses Gemini for AI-assisted dev, no Claude Code)

Division of labor:
- **Lead owns**: agent loop, prompts, schemas, inference clients, audit log, deployment
- **Teammate owns**: frontend UI, demo video editing, slide deck, runbook corpus authoring, README copy

## Vultr resources provisioned

### Object Storage
- **Subscription label**: roguemouse-audit
- **Region**: ams1 (Amsterdam)
- **Endpoint**: https://ams1.vultrobjects.com
- **Bucket**: roguemouse-audit-log
- **Visibility**: Private
- **Versioning**: Off
- **Archival**: Off
- **Object Lock**: Not supported by Vultr
- **Credentials**: Stored in password manager as `roguemouse-s3-access-key` and `roguemouse-s3-secret-key`

### Serverless Inference
- **Subscription**: Active
- **Base URL**: https://api.vultrinference.com/v1
- **Ops Engineer model (locked)**: `nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16`
- **Pricing**: $0.13/M input tokens, $0.38/M output tokens
- **Context window**: 262K tokens
- **API key**: Stored in password manager as `roguemouse-vultr-inference-key`
- **Live verification**: Passed end-to-end chat completion test on 2026-05-14

### Cloud Compute VPS
- **Label**: roguemouse-vps
- **IP**: 95.179.138.253
- **IPv6**: 2a05:f480:1400:224a:5400:6ff:fe28:a63a
- **OS**: Ubuntu 22.04.5 LTS x64
- **Plan**: vc2-2c-4gb (2 vCPU shared, 4 GB RAM, 80 GB SSD)
- **Region**: Amsterdam
- **SSH access**: `ssh -i ~/.ssh/id_ed25519_roguemouse root@95.179.138.253`
- **Status**: Running, fresh install, cloud-init complete
- **Coolify**: Not yet installed (planned for Day 2)

## Gemini API

- **Status**: Configured and verified end-to-end (Sprint 4a, 2026-05-16)
- **API key**: Stored in `.env.local` as `GEMINI_API_KEY` (39-char `AIza...` format from https://aistudio.google.com/apikey); password-manager entry `roguemouse-gemini-api-key`
- **Models locked for Sprint 4 family**:
  - Risk Officer voice (Sprint 4a smoke verified, Sprint 4c production): `gemini-2.5-flash`
  - Synthesizer voice (Sprint 4c): `gemini-2.5-flash`
- **Why Flash instead of Pro for Risk Officer**: free-tier `gemini-2.5-pro` has `limit: 0` quota and requires billing on the Google Cloud project. Sprint 4a pivoted to `gemini-2.5-flash` via `GEMINI_RISK_MODEL` env var (Decision 3C's env-driven design enabled the one-line resolution). Sprint 7 polish may revisit Pro for the demo if billing is enabled.
- **Endpoint**: OpenAI-compatibility (`https://generativelanguage.googleapis.com/v1beta/openai/`) via the existing `openai` npm package; zero new direct dependencies. Brainstorm Decision 1B.

## Credit budget

- **Starting**: $200 Vultr credits
- **Consumed so far (estimated)**: ~$5–10 over 6 days
  - Object Storage Standard prorated: ~$3.60
  - Serverless Inference subscription: $10 (full month, not prorated)
  - VPS prorated: ~$4.00
- **Remaining headroom**: ~$185
- **Risk**: low

## Stack decisions

- **Language**: TypeScript 5.6+
- **Runtime**: Node 20 LTS
- **Package manager**: pnpm 10.27+ workspaces (no Turborepo)
- **Frontend**: Next.js 15+ App Router, `output: 'standalone'`, Tailwind CSS
- **API layer**: Next.js API routes (not a separate backend service)
- **Validation**: Zod 3+
- **Testing**: Vitest
- **CI**: GitHub Actions
- **Deployment**: Docker image built in GitHub Actions, pulled by Vultr VPS, orchestrated by Coolify (TBD) or plain Docker Compose + Caddy (fallback)

## Architectural decisions made

- **Audit log integrity**: SHA-256 hash chain at application layer (no Object Lock)
- **RAG strategy**: Application-layer (our retrieval, our prompt injection) — not Vultr's `/v1/chat/completions/RAG` endpoint
- **LLM error handling**: Structured `{ ok, error }` envelopes; never throw
- **Tool orchestration**: Planner code calls tools; LLMs reason over tool outputs but do not directly invoke tools
- **Mock broker**: Deterministic fixture replay only; no live trading anywhere
- **Sprint pacing**: Workspace scaffolding (Sprint 1) is separated from the smoke test (Sprint 2). Reason: scaffolding is mechanical and unlocks teammate's UI work; smoke test is the first real workflow exercise and benefits from full 5-stage protocol.
- **First sprint commit pattern**: Single commit per sprint covering all phases, after /review-task passes. Sprint 1's commit (38f8728) covers 39 files; future sprints follow the same pattern. Rationale: clean revert boundary, atomic deploys, single-message commit history aligned with sprint documents.
- **Envelope discipline for all I/O packages**: @roguemouse/inference and @roguemouse/audit both expose functions returning `{ ok: true, data, ... } | { ok: false, error: { code, message, retryable, step? } }` discriminated unions. Public APIs never throw — every error path returns a structured envelope. Established in Sprint 2 (Phase 3 for inference, Phase 4 for audit). Rationale: consumers write `if (result.ok)` instead of try/catch; Sprint 3+ circuit breakers and retries can be added without changing call sites.
- **AppendInput omits chain-controlled fields**: RunAuditWriter.append takes Omit<AuditRecordBody, "previousHash" | "runId"> rather than the full envelope. previousHash is owned by the writer's hash chain state; runId is owned by the constructor. The API surface makes chain corruption impossible by construction. Established in Sprint 2 (Phase 4). Rationale: defense in depth — the audit log integrity story doesn't rely on callers passing correct values, because they can't pass them at all.
- **Discriminated union shape for the audit record body**: envelope-level z.discriminatedUnion("recordType", [...]) rather than internal "kind" tagging on the payload. Established in Sprint 3 Phase 4. Rationale: single source of truth (recordType is the only discriminator); no redundant tags in serialized records; Zod's safeParse narrows the payload type at consumers; compile-time recordType ↔ payload coupling.
- **Tool schema pattern: shared defineTool helper + TOOLS registry**: 8 tool definitions, each constructed via defineTool(name, argsSchema, resultDataSchema), aggregated in a TOOLS const object exported from @roguemouse/schemas. ToolName, ArgsFor<TName>, DataFor<TName> derived from the registry. Established in Sprint 3 Phase 3. Rationale: generic dispatch becomes possible (dispatchTool<TName>(name, args)); audit logging is uniform (one tool:call recordType, one tool:result recordType across all 8 tools); adding a 9th tool is a registry extension, not a schema change.
- **Leaf-module discipline for shared primitives**: validation primitives that multiple sibling modules need (regex constants, literal arrays) live in a zero-import leaf module (packages/schemas/src/primitives.ts). The module imports nothing — not even zod. Established in Sprint 3 Phase 4 amendment. Rationale: prevents circular imports that would otherwise arise when sibling modules cross-reference each other through shared constants. Pattern is reusable for any future shared primitive.
- **Gemini model selection for Sprint 4 family**: Risk Officer voice uses `gemini-2.5-flash` (Sprint 4a verified); Synthesizer voice uses `gemini-2.5-flash` (Sprint 4c, planned). Pro 2.5 was the original target but free-tier quota = 0 forced the pivot. Sprint 7 polish may upgrade Risk Officer to Pro 2.5 IF billing is enabled on the Google Cloud project before the demo. Decision date: Sprint 4a Phase 4 (2026-05-16). Captured in `tasks/lessons.md`.
- **Cross-provider envelope discipline validated through symmetric classifier extraction**: One wrapped chat-completion function shape serves both Vultr Nemotron (Sprint 2) and Gemini (Sprint 4a) by going through the openai SDK pointed at different baseURLs. The error classifier (`classifyInferenceError`) was extracted from `chatCompletion.ts` (file-local) to `packages/inference/src/errors.ts` (package-internal, mirrors `packages/audit/src/errors.ts`'s `classifyS3Error` precedent) so both provider wrappers can share it. Established in Sprint 4a Phase 2. Rationale: any third LLM provider that goes through the openai SDK (which Gemini uses, and several others do too) reuses this classifier without modification. The envelope shape (`{ok: true, data, usage?} | {ok: false, error: {code, message, retryable, step?}}`) is now the cross-package standard across `@roguemouse/inference` and `@roguemouse/audit`.
- **Errors-module pattern: provider-internal HTTP/network error classifier in a dedicated file**: Two instances of the pattern now exist — `packages/audit/src/errors.ts` (`classifyS3Error`, Sprint 2) and `packages/inference/src/errors.ts` (`classifyInferenceError`, Sprint 4a). The shape is consistent: a classifier function that translates SDK-specific exceptions into the package's structured error envelope; the classifier is package-internal (not exported from the barrel); JSDoc cross-references the other instance. Pattern is now established for any future I/O package.

## Architectural decisions deferred

- UI framework decisions inside Tailwind (component library? shadcn/ui?) — defer to Day 4

## Artifacts

Durable project references captured as sprints land. These values are pinned in code, tests, and documentation; any one of them being wrong would break the audit log integrity story.

### Genesis hash (Sprint 2)

`b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc`

SHA-256 of the UTF-8 bytes of the literal string `roguemouse-audit-genesis-v1`. This is the `previousHash` field of every chain's first record, forever (until intentionally rotated via `-v2` suffix). Pinned in `packages/audit/src/genesis.ts`, `packages/audit/src/genesis.test.ts` (with recomputation cross-check), and `docs/sprints/smoke-test-vultr-integration/plan.md`.

### First audit record (Sprint 2 Phase 6, 2026-05-15T07:26:03 UTC)

S3 object key:

```
audit/e7ec58ef-c65a-47ee-9b4f-095e073d23f7/2026-05-15T07-26-03.694Z-d963304fcc1d89806ee836d663c0087aabe922bdc03a51613bffc6cd78d0fb13.json
```

Bucket: `roguemouse-audit-log`, region `ams1`, endpoint `https://ams1.vultrobjects.com`. Run ID: `e7ec58ef-c65a-47ee-9b4f-095e073d23f7`. Record hash: `d963304fcc1d89806ee836d663c0087aabe922bdc03a51613bffc6cd78d0fb13`. This record's `previousHash` field is the genesis hash above. It is the "patient zero" of every chain we ever write — the first proof that the integration works end-to-end.

### Second audit record / Sprint 3 verification artifact (Sprint 3 Phase 5, 2026-05-16T07:20:54 UTC)

S3 object key:

```
audit/a35daa82-f0f3-43d8-b945-7f52def87c27/2026-05-16T07-20-54.940Z-71dfe6cc8adf71e53b4702e9c8bf5a85fb02a15adae7e85b400803fbf30ae1fa.json
```

Bucket: `roguemouse-audit-log`, region `ams1`. Run ID: `a35daa82-f0f3-43d8-b945-7f52def87c27`. Record hash: `71dfe6cc8adf71e53b4702e9c8bf5a85fb02a15adae7e85b400803fbf30ae1fa`. This record's `previousHash` field is the genesis hash above (identical to the Sprint 2 first record's previousHash — both are chain-rooted at genesis). The record proves the Sprint 3 refactor (discriminated union narrowing, canonicalize relocation, primitives.ts extraction, writer-side typing fix) preserved end-to-end Vultr round-trip integrity.

### Third audit record / Sprint 4a verification artifact (Sprint 4a Phase 4, 2026-05-16T21:42:34 UTC)

S3 object key:

```
audit/0ca812ef-3214-4e98-ad43-9b1fddbdd4aa/2026-05-16T21-42-34.772Z-a02091694720ccd80831f2283315a1ee89c1efa07eb47635d4ab225f2a9303dc.json
```

Bucket: `roguemouse-audit-log`, region `ams1`. Run ID: `0ca812ef-3214-4e98-ad43-9b1fddbdd4aa`. Record hash: `a02091694720ccd80831f2283315a1ee89c1efa07eb47635d4ab225f2a9303dc`. Model used: `gemini-2.5-flash` (env-driven pivot from `gemini-2.5-pro` due to free-tier quota; documented in `tasks/lessons.md`). Token usage: 49 prompt / 40 completion / 1045 total (the 956-token gap is Flash's thinking-mode allocation, enabled by default through the OpenAI-compat endpoint). This is the third audit record overall in the bucket AND the first-ever `risk_officer:reasoning` record — the first of 12 locked recordType branches from Sprint 3 to be exercised end-to-end.

## Sprint status

### Sprint 0 — Infrastructure provisioning ✅ Complete (2026-05-14)
- SSH key generated and added to Vultr
- Vultr API key created with scoped ACL
- Object Storage provisioned and bucket created
- Serverless Inference subscription active, Ops Engineer model verified
- VPS provisioned, SSH access confirmed

### Sprint 0.5 — Claude Code workflow scaffolding ✅ Complete (2026-05-14)
- CLAUDE.md, ROGUEMOUSE_CONTEXT.md, .claude/commands/, .claude/rules/, tasks/, docs/sprints/ created
- 5-stage workflow protocol installed (brainstorm → spec → plan → implement → review)
- Commit: 2102728
- First lessons.md entry recorded (markdown-paste corruption pattern)

### Sprint 1 — Local workspace scaffolding ✅ Complete (2026-05-14)
- Compressed workflow: spec+plan combined, no brainstorm (no design decisions worth exploring)
- 39 files created across root config, 7 package skeletons (`packages/*`), and Next.js app (`apps/web`)
- pnpm install clean, pnpm -r typecheck clean across 8 typecheckable projects
- pnpm --filter @roguemouse/web build clean (standalone output produced; Windows Developer Mode required for symlink creation)
- Dev server verified locally on http://localhost:3000
- Documentation: docs/sprints/workspace-scaffold/spec-and-plan.md, review.md
- Commit: 38f8728
- One deferred item in tasks/todo.md (pre-submission Meridian-reference sweep)

### Sprint 2 — smoke-test-vultr-integration ✅ Complete (2026-05-15)
- Full 5-stage workflow (first real exercise of the protocol): brainstorm → spec → plan → implement (6 phases) → review
- 32 files changed, 4,206 insertions across packages/schemas, packages/audit, packages/inference, scripts/
- 34 acceptance criteria all PASS, verified against on-disk code and live run output
- Live Phase 6 smoke run against real Vultr: exit 0, 2099ms total, $0.0000518 cost
- First audit record cryptographically verified end-to-end (round-trip hash recompute, genesis chain bootstrap)
- Locked artifacts (inherited by every future sprint):
  - Audit record envelope: { ts, runId, recordType, previousHash, payload } with strict() field enforcement
  - Genesis hash: b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc (SHA-256 of "roguemouse-audit-genesis-v1")
  - Canonicalization: rolled-own, recursive object-key sort, JSON-safe values only
  - Inference + audit envelope discipline: { ok, data } | { ok, error } discriminated unions, never throw
  - Object key format: audit/{runId}/{ts-safe}-{hash}.json
  - In-memory RunAuditWriter for hash chain state (Sprint 4 reconsiders for API route lifetime)
- Commit: 9767863
- Documentation: docs/sprints/smoke-test-vultr-integration/{brainstorm,spec,plan,review}.md
- One lesson added during the sprint (Phase 1 conditional-exports resolution discipline)
- One deferred item added to tasks/todo.md (RFC 8785 canonicalization migration trigger)

### Sprint 3 — Tool Schema lock + audit log consolidation ✅ Complete (2026-05-16)
- Full 5-stage workflow (second real exercise of the protocol): brainstorm → spec → plan → implement (5 code phases + 1 review) → review
- 31 files changed, 3,727 insertions across packages/schemas (mostly), packages/audit, scripts/
- 36 acceptance criteria all PASS, verified against on-disk code and live Phase 5 run output
- Live Phase 5 smoke run against real Vultr (post-refactor): exit 0, 2566ms total, $0.000090 cost
- Round-trip integrity verified end-to-end through the discriminated-union narrowing + canonicalize migration
- Day 2 hackathon kill-switch retroactively closed: Tool Schema + Audit Schema are both locked
- Locked artifacts (inherited by Sprint 4+):
  - Audit record envelope: z.discriminatedUnion("recordType", [...12 branches...]) with `.strict()` per branch
  - 12 recordType literals: smoke_test:chat_completion, tool:call, tool:result, anomaly:detected, risk_officer:reasoning, ops_engineer:reasoning, synthesizer:reasoning, synthesizer:proposal, synthesizer:refusal, human:approval, human:rejection, final:committed
  - 8 agent tool schemas in @roguemouse/schemas/tools/: market_data:lookup, runbook:search, position:snapshot, broker:reconcile, audit:append, audit:search, score:explain, policy:check
  - Tool result envelope: { ok: true, data: T } | { ok: false, error: ToolError } — same shape as inference/audit envelopes
  - dispatchTool<TName>(name, args) type signature: narrows args + return type by name literal; runtime implementation deferred to Sprint 4
  - canonicalize relocated from @roguemouse/audit to @roguemouse/schemas (rules + serializer co-located)
  - sha256Hex, GENESIS_HASH, GENESIS_SEED remain in @roguemouse/audit
  - primitives.ts (leaf module in @roguemouse/schemas): ISO_TIMESTAMP_MS_REGEX, HEX_64_REGEX, TOOL_NAME_LITERALS
  - AppendInput is now a discriminated union via Omit distribution: mismatched recordType+payload pairs are compile-time errors
- Commit: 0e61f0a
- Documentation: docs/sprints/tool-schema-and-payload-narrowing/{brainstorm,spec,plan,review}.md
- No new dependencies added in this sprint (zero package.json changes)

### Sprint 4 — First end-to-end scenario + Gemini integration (split into 4a/4b/4c)

#### Sprint 4a — Gemini integration smoke test ✅ Complete (2026-05-16)
- Goal 1 of the original Sprint 4 plan: verify Gemini API integration end-to-end, analogous to Sprint 2's Vultr smoke test
- 27 acceptance criteria all PASS, verified against on-disk code + live Phase 4 PASS report
- Live smoke run against real Gemini + real Vultr: exit 0, 5787ms total
- Third audit record in the bucket (first-ever `risk_officer:reasoning` recordType)
- Model used: `gemini-2.5-flash` (env-driven pivot from `gemini-2.5-pro` due to free-tier quota = 0; documented in `lessons.md`)
- Cross-provider envelope discipline validated: `classifyInferenceError` extracted from `chatCompletion.ts` to `errors.ts`; both Vultr and Gemini wrappers share it
- Commit: 12174f3
- Documentation: docs/sprints/gemini-integration-smoke-test/{brainstorm,spec,plan,review}.md
- 12 files changed, 2,214 insertions, 72 deletions
- No new dependencies (Decision 1B held)

#### Sprint 4b — dispatchTool runtime + 8 tool implementations + RAG ⏳ Next
- Goals 2, 3, and 6 of the original Sprint 4 plan
- Implements the 8 tool schemas locked in Sprint 3: `market_data:lookup`, `runbook:search`, `position:snapshot`, `broker:reconcile`, `audit:append`, `audit:search`, `score:explain`, `policy:check`
- Implements the `dispatchTool<TName>(name, args)` runtime in `@roguemouse/agent` (Sprint 3 locked the type signature; this sprint provides behavior)
- Implements application-layer RAG over the runbook corpus (5 runbooks landed in 0e7681b, used by `runbook:search` tool)
- Estimated scope: large; Sunday's work, possibly into Monday morning
- Key open questions for brainstorm: which tools are dispatched in parallel vs serial; how the dispatch logs `tool:call` and `tool:result` audit records without recursing into `audit:append`; how RAG retrieval is implemented (in-memory keyword match for the hackathon; vector DB deferred to post-submission)

#### Sprint 4c — Scenario A: Stale IV Surface ⏳ Queued
- Goals 4 and 5 of the original Sprint 4 plan
- Multi-agent debate runtime: Risk Officer voice (`gemini-2.5-flash`) + Ops Engineer voice (Vultr Nemotron) + Synthesizer voice (`gemini-2.5-flash`)
- End-to-end scenario assembly: anomaly detection → tool invocation → multi-agent debate → proposal/refusal output → multi-record audit chain
- First scenario that writes ~120 audit records per run (vs Sprints 2/3/4a which each wrote one)
- Estimated scope: medium-large; Monday's work
- Submission deadline: Tuesday May 19 17:00 CEST (08:00 PDT); 4c MUST land by Monday evening to leave Tuesday morning for Sprint 5/6/7 minimum-viable polish

### Sprint queue
- Sprint 4c — Scenario A: Stale IV Surface (queued after 4b)
- Sprint 5 — Remaining scenarios (B: Phantom Duplicate, C: Composite Score Inversion); inherits the agent loop from Sprint 4c
- Sprint 6 — Vultr VPS deploy + Coolify setup
- Sprint 7 — Polish, demo video, slide deck, submission copy, cover image

## Open questions

1. Coolify vs. manual Docker Compose — decide on Day 2 based on Coolify trial
2. Demo URL — use IP address directly, or get a custom domain pointing at the VPS?
3. Operator authentication for demo — single hardcoded user, or skip auth entirely?

## Files to read at session start

In this order:
1. `CLAUDE.md`
2. `.claude/rules/workflow.md`
3. `.claude/rules/stack.md`
4. `.claude/rules/vultr.md`
5. `.claude/rules/hackathon.md`
6. `tasks/lessons.md`
7. `ROGUEMOUSE_CONTEXT.md` (this file)
