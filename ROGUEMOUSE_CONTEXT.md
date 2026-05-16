# Roguemouse Context (Ground Truth)

This file is the canonical state of the project. **Update it whenever state changes.** It is read at every session start.

**Last updated**: 2026-05-15
**Current sprint**: Sprint 3 — Tool Schema lock + audit log consolidation (about to start)

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

## Gemini setup

- **Status**: Not yet configured
- **Planned roles**:
  - Risk Officer voice: Gemini 2.5 Pro (development), Gemini 3 Pro (demo)
  - Synthesizer: Gemini Flash
- **API key**: Not yet generated (Google AI Studio)

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

## Architectural decisions deferred

- Specific Gemini model versions (Pro 2.5 vs 3, Flash 1.5 vs 2.5) — verify at first Gemini integration
- UI framework decisions inside Tailwind (component library? shadcn/ui?) — defer to Day 4

## Artifacts

Durable project references captured as sprints land. These values are pinned in code, tests, and documentation; any one of them being wrong would break the audit log integrity story.

### Genesis hash (Sprint 2)

`b44adada69b19012e01600e58f2fb29df2ae945ddf14f05dfa44eddde0a23bcc`

SHA-256 of the UTF-8 bytes of the literal string `roguemouse-audit-genesis-v1`. This is the `previousHash` field of every chain's first record, forever (until intentionally rotated via `-v2` suffix). Pinned in `packages/audit/src/genesis.ts`, `packages/audit/src/genesis.test.ts` (with recomputation cross-check), and `docs/sprints/smoke-test-vultr-integration/plan.md`.

### First audit record (Sprint 2 Phase 6, 2026-05-15T07:26:03 UTC)

S3 object key:

`audit/e7ec58ef-c65a-47ee-9b4f-095e073d23f7/2026-05-15T07-26-03.694Z-d963304fcc1d89806ee836d663c0087aabe922bdc03a51613bffc6cd78d0fb13.json`

Bucket: `roguemouse-audit-log`, region `ams1`, endpoint `https://ams1.vultrobjects.com`. Run ID: `e7ec58ef-c65a-47ee-9b4f-095e073d23f7`. Record hash: `d963304fcc1d89806ee836d663c0087aabe922bdc03a51613bffc6cd78d0fb13`. This record's `previousHash` field is the genesis hash above. It is the "patient zero" of every chain we ever write — the first proof that the integration works end-to-end.

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

### Sprint 3 — Tool Schema lock + audit log consolidation ⏳ Next
- Full 5-stage workflow (second real exercise of the protocol)
- Goals:
  1. Lock the 8 agent tool schemas as discriminated unions in @roguemouse/schemas
  2. Narrow audit record payload from `payload: unknown` to a discriminated union keyed on recordType
  3. Consolidate canonicalization rules (currently split between @roguemouse/schemas and @roguemouse/audit)
- Will close the Day 2 kill-switch checkpoint (Tool Schema locked = Vector Store RAG stays in scope)
- Estimated scope: 300-500 lines, mostly schemas + tests, no new external integrations

### Sprint queue
- Sprint 4 — First end-to-end scenario (Scenario A: Stale IV Surface), introduces Gemini integration
- Sprint 5 — Remaining scenarios (B: Phantom Duplicate, C: Composite Score Inversion)
- Sprint 6 — Vultr VPS deploy + Coolify setup
- Sprint 7 — Polish, demo video, slide deck, submission copy

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
