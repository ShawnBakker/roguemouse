# Roguemouse Context (Ground Truth)

This file is the canonical state of the project. **Update it whenever state changes.** It is read at every session start.

**Last updated**: 2026-05-14
**Current sprint**: Sprint 2 — smoke-test-vultr-integration (about to start)

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

## Architectural decisions deferred

- Specific Gemini model versions (Pro 2.5 vs 3, Flash 1.5 vs 2.5) — verify at first Gemini integration
- UI framework decisions inside Tailwind (component library? shadcn/ui?) — defer to Day 4

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

### Sprint 2 — smoke-test-vultr-integration ⏳ Next
- Full 5-stage workflow (first real exercise of the protocol; not compressed)
- Goal: validate end-to-end Vultr integration with one chat completion + one audit record + one Object Storage write + one read-back
- Will lock the audit record Zod schema as a first-class artifact
- Estimated scope: 200-300 lines across packages/schemas, packages/audit, packages/inference, plus a smoke test runner

### Sprint queue
- Sprint 2 — smoke-test-vultr-integration (full 5-stage workflow; first real exercise of the protocol)
- Sprint 3 — Tool Schema lock + audit log package
- Sprint 4 — First end-to-end scenario (Scenario A: Stale IV Surface)
- Sprint 5 — Remaining scenarios (B: Phantom Duplicate, C: Composite Score Inversion)
- Sprint 6 — Vultr VPS deploy + Coolify setup
- Sprint 7 — Polish, demo video, submission

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
