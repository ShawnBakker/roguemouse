# CLAUDE.md — Roguemouse

**Project**: Roguemouse — autonomous AI Operations Officer for algorithmic trading platforms.

**Built for**: AI Agent Olympics Hackathon · Milan AI Week 2026.
**Submission deadline**: 17:00 CEST · Tuesday, May 19, 2026.
**Internal target**: Submit by 20:00 PDT · Monday, May 18, 2026 (12-hour buffer).

---

## Session start — required reads

At the start of every Claude Code session, read these files in order, before doing anything else:

1. `CLAUDE.md` — this file (you are here)
2. `.claude/rules/workflow.md` — the 5-stage development protocol (non-negotiable)
3. `.claude/rules/stack.md` — TypeScript / pnpm / Next.js conventions
4. `.claude/rules/vultr.md` — Vultr-specific gotchas and required patterns
5. `.claude/rules/hackathon.md` — submission constraints and IP firewall rules
6. `tasks/lessons.md` — corrections and anti-patterns from past mistakes
7. `ROGUEMOUSE_CONTEXT.md` — current state ground truth (resources, models, sprint status)

Do not skip any of these. They are short and they prevent re-litigating decisions.

---

## The development protocol — non-negotiable

ALL features and architectural changes follow this 5-stage workflow in strict order:
/brainstorm  →  /spec-task  →  /plan-task  →  /implement-task  →  /review-task

Each stage produces one document in `docs/sprints/[feature-name]/`. Each stage has an explicit STOP gate — proceed to the next stage only on explicit operator approval.

Never skip stages. Never jump straight to implementation. This is as non-negotiable as the "no live trades" rule.

For trivial changes (typos, single-file cosmetic edits, dependency bumps), the protocol can compress to spec+plan in a single document and implement. For anything that touches the agent loop, audit log, schemas, or inference clients, the full 5-stage protocol is mandatory.

---

## Hard rules

These cannot be relaxed. Violating them is a critical failure.

1. **No code from any prior project.** Roguemouse is a fresh MIT-licensed repo. Architectural patterns from Meridian are fine to apply; source code is not. Git history starts May 13, 2026.

2. **No Vercel SDK, no Vercel-specific features.** Deploy target is Vultr VPS via Docker. Next.js must use `output: 'standalone'`. No Edge runtime. No `next/image` optimization that depends on Vercel.

3. **No live trading. No real money.** The "broker" is a deterministic mock that replays seeded fixtures. Every demo run produces identical results given identical seeds.

4. **Audit log integrity is application-layer.** Vultr Object Storage does not support S3 Object Lock. Tamper-evidence is enforced via SHA-256 hash chaining in our code. Every audit record's `previousHash` field must equal the SHA-256 of the prior record's canonicalized JSON. Never write an audit record that breaks the chain.

5. **LLM client code never throws.** Returning a structured error (`{ ok: false, error: { code, message, retryable, suggestion } }`) is mandatory. Throwing causes uncontrolled retries and breaks the planner's ability to reason about failures.

6. **Read files immediately before editing them.** Do not rely on file contents from earlier in the session. Context decay is real. After 10+ messages, re-read.

---

## File map
repo root/
CLAUDE.md                  ← you are here
ROGUEMOUSE_CONTEXT.md      ← ground truth state (resources, models, current sprint)
README.md                  ← public-facing project description
LICENSE                    ← MIT
.claude/
commands/                ← slash command definitions
rules/                   ← persistent rules (read every session)
tasks/
lessons.md               ← anti-patterns from past mistakes (empty until first correction)
todo.md                  ← parking lot for out-of-scope ideas
docs/
sprints/[feature]/       ← one folder per feature, contains brainstorm/spec/plan/review docs
apps/web/                  ← Next.js app (frontend + API routes)
packages/
schemas/                 ← Zod schemas (single source of truth)
agent/                   ← planner loop, voices, prompts
tools/                   ← tool implementations
inference/               ← LLM clients with circuit breakers
audit/                   ← Vultr Object Storage client with hash chain
broker-mock/             ← deterministic fixture replay
runbooks/                ← synthetic runbook corpus
fixtures/                  ← test fixtures per demo scenario
infra/                     ← Dockerfile, Coolify config, Caddy fallback

---

## Slash commands available

- `/brainstorm` — explore approaches with tradeoffs
- `/spec-task` — write functional requirements
- `/plan-task` — write phased implementation plan
- `/implement-task` — execute plan phase by phase
- `/review-task` — audit against spec and conventions

See `.claude/commands/` for the full definitions.

---

## Session end

Before ending any session, update `ROGUEMOUSE_CONTEXT.md` if state changed:

- Vultr resources added or modified
- Models locked or rotated
- Sprint state (current sprint, blockers, last commit)
- Architectural decisions made

This is how state carries across sessions when context resets.
