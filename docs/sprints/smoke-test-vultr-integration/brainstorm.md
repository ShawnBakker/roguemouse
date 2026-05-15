# smoke-test-vultr-integration — Brainstorm

## Problem

Roguemouse's runtime depends on two Vultr services we have not yet exercised from TypeScript: Vultr Serverless Inference (`https://api.vultrinference.com/v1`) for the Ops Engineer voice, and Vultr Object Storage (`https://ams1.vultrobjects.com`, bucket `roguemouse-audit-log`) for the audit log. Infrastructure provisioning (Sprint 0) confirmed both services respond to manual probes — a one-off PowerShell `curl` chat completion and a console-side bucket creation — but neither has been called from our application stack, with the `openai` package against Vultr's `baseURL` and the AWS SDK against Vultr's S3-compatible endpoint.

The smoke test must validate the end-to-end pipeline once: one chat completion, one audit record describing the call, hash-chained from genesis, written to Object Storage, read back, integrity verified. This is the discovery point for integration assumptions that could break us in Sprint 4 (signing/region quirks, `openai` SDK incompatibilities with Vultr's endpoint, gzip Content-Length surprises, schema decisions that don't survive their first real exercise). It also locks the **audit record envelope** as a first-class artifact — every future sprint inherits whatever schema we write here, so the design space is worth exploring before the spec.

## Existing code touched

The codebase is post-scaffolding (Sprint 1, commit `38f8728`). Most code does not exist yet — the smoke test creates the first real code in three packages.

- `packages/schemas/src/index.ts:1` — stub: `export const __packageName = "@roguemouse/schemas";`. The audit record Zod schema goes here.
- `packages/audit/src/index.ts:1` — stub. The Object Storage client, canonicalizer, hasher, and `RunAuditWriter` go here.
- `packages/inference/src/index.ts:1` — stub. The `openai`-against-Vultr client (no circuit breaker yet — that's Sprint 3+) goes here.
- `packages/schemas/package.json`, `packages/audit/package.json`, `packages/inference/package.json` — typecheck/build/test scripts present; dependencies (`zod`, `@aws-sdk/client-s3`, `openai`) not yet added.
- `package.json:15-21` — root scripts include `dev`, `test`, `typecheck`, `build`, `lint`. No `smoke` script yet; this sprint adds one.
- `.env.local`, `.env.example` — do not yet exist. The smoke test runner needs `VULTR_INFERENCE_API_KEY`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, plus the locked endpoint/bucket/model constants from `.claude/rules/vultr.md`.
- `tsconfig.base.json` — exists and is extended by every package. No changes expected.

No production code exists yet for these packages, so this sprint defines the public surface, not refactors an existing one.

---

## Decision 1 — Audit record schema shape

### Option A — Core integrity envelope + `recordType` string + `payload: unknown`

Lock the cryptographic fields now (`ts`, `runId`, `recordType`, `previousHash`, `recordHash`) and leave `payload` as `z.unknown()` for Sprint 2. `recordType` is a `z.string()` for now; Sprint 3 narrows it to a literal union and binds each value to a `payload` shape via `z.discriminatedUnion`.

Pros:
- Smallest possible Sprint 2 schema (~20 lines of Zod).
- No breaking change when Sprint 3 narrows `recordType` and `payload` — existing records still parse against the wider schema.
- Forces every future record to declare its `recordType`, so the discriminator field exists from day one.

Cons:
- `payload: unknown` means consumers in Sprint 2 must cast or re-parse before use.
- The smoke test is the only consumer in Sprint 2, so this cost is theoretical.

Complexity: small.
Forces into scope: `recordType` as a free-form string. The smoke test uses `recordType: "smoke_test:chat_completion"`.
Anti-features: no per-recordType validation in Sprint 2; no automatic type narrowing in consumers.

### Option B — Full discriminated union with one variant defined now

Define `z.discriminatedUnion("recordType", [...])` with one variant (`chat_completion`) fully typed. Future sprints add variants (`tool_call`, `human_approval`, `refusal`, `synthesis`) without touching the integrity envelope.

Pros:
- Locks the discriminated-union *pattern* permanently in Sprint 2; Sprint 3 only adds variants.
- Type narrowing works in consumers from day one.

Cons:
- Forces us to design the `chat_completion` payload shape before we have spec pressure to do so — we don't yet know what fields Sprint 4's planner will want to record.
- Probable rework: the `chat_completion` variant defined in isolation here may not match the shape that emerges from Sprint 4's full agent loop.

Complexity: medium.
Forces into scope: a complete `chat_completion` payload schema (model name, prompt tokens, completion tokens, response text, latency, cost estimate, error envelope variant).
Anti-features: none — this is the heavy option.

### Option C — Minimal-now-extensible-later (no `recordType` yet)

Lock only `ts`, `runId`, `previousHash`, `recordHash`, `payload: unknown`. Add `recordType` and the discriminated union in Sprint 3.

Pros:
- Smallest possible envelope (~15 lines).
- No premature commitment to a discriminator field.

Cons:
- Adding `recordType` in Sprint 3 *is* a breaking schema change — every existing record (including Sprint 2's smoke-test record) must be migrated or excluded by version.
- We pay the schema-version-migration tax to save five lines of code in Sprint 2.

Complexity: small.
Forces into scope: a future schema migration in Sprint 3.
Anti-features: any structured queryability of the audit log (you can't filter by record type if there is no record type).

---

## Decision 2 — Hash chain bootstrap

### Option A — Hardcoded versioned genesis constant

`GENESIS_HASH = sha256("roguemouse-audit-genesis-v1")` computed at module load. Every run's first record uses this as `previousHash`.

Pros:
- Verifier is one constant comparison.
- A tampered genesis is visible: any audit record claiming `previousHash` ≠ this constant is malformed.
- Version suffix (`-v1`) preserves the option to break the chain format intentionally in the future.

Cons:
- The constant must match between writer and verifier — a copy-paste rename would silently produce two incompatible audit corpora.

Complexity: small.
Forces into scope: a single exported constant in `@roguemouse/audit` (or `@roguemouse/schemas`).
Anti-features: cross-run chaining — each run starts fresh from genesis, so you can't prove ordering between two separate runs from the chain alone (you'd need an out-of-band run registry, which we don't need for Sprint 2).

### Option B — SHA-256 of empty string

`GENESIS_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"`.

Pros:
- Universally recognizable; matches Git's empty-blob convention.

Cons:
- No version room — if we ever want to break the chain format intentionally, we have to invent a different convention.
- Slightly less debuggable: a developer who sees `e3b0c44...` might assume it means "I forgot to set the previous hash."

Complexity: small.
Forces into scope: same as A.
Anti-features: same as A, plus no easy versioning.

### Option C — `null` previousHash, verifier treats as genesis

The first record's `previousHash` is `null`; the verifier accepts that as the genesis marker.

Pros:
- No magic constant to remember.

Cons:
- Schema becomes `previousHash: z.string().nullable()` — every consumer must handle the null case forever.
- Genesis records are now structurally distinct from chain records, which complicates verification.
- A tampered record could claim `previousHash: null` to masquerade as a genesis; the verifier must additionally check that no other genesis exists in the run.

Complexity: medium.
Forces into scope: nullable-field handling everywhere `previousHash` is read.
Anti-features: schema uniformity.

### Option D — `runId` as `previousHash` for the first record

Couples runs to their genesis: `previousHash = sha256(runId)` for the first record.

Pros:
- Each run has a unique genesis, so two runs cannot accidentally produce the same chain.

Cons:
- `runId` is operator-supplied or generated; if it's predictable, the genesis is predictable, which adds no security.
- More moving parts than A.

Complexity: small.
Forces into scope: passing `runId` into the hasher at genesis time.
Anti-features: simplicity.

---

## Decision 3 — Canonicalization for hashing

### Option A — RFC 8785 (JSON Canonicalization Scheme) via npm

Add a published implementation (e.g., `canonicalize` or `@truestamp/canonify`, both MIT). Handles UTF-8 NFC normalization, IEEE 754 number serialization, and escape-sequence quirks per spec.

Pros:
- Standards-compliant; the right answer if we ever submit Roguemouse to an audit by a regulator who knows JCS.
- Handles edge cases (NaN, Infinity, floats with imprecise decimal representations, surrogate pairs) without us thinking about them.
- One sentence to explain in the README: "we use RFC 8785."

Cons:
- New dependency for a use case that, for Sprint 2, has no UTF-8 or float edge cases.
- Slightly more bytes in the bundle.

Complexity: small (add dependency, call function).
Forces into scope: pinning a third-party canonicalizer; verifying its license is MIT/Apache/BSD per `hackathon.md`.
Anti-features: ownership of the canonicalization algorithm.

### Option B — Rolled-own recursive key-sort + `JSON.stringify`

~15 lines: walk the value, sort object keys recursively, return a stably-keyed plain object, `JSON.stringify` it with no spacing.

Pros:
- Zero new dependencies.
- Covers our actual payload shape (strings, integers, booleans, nested plain objects).
- Trivial to read in code review; the algorithm fits on one screen.

Cons:
- Subtly wrong for: non-integer numbers (JS `JSON.stringify` produces `1` vs `1.0` inconsistently across engines if a value transitions between representations), Unicode strings that aren't pre-normalized, sparse arrays. None of these appear in our payloads today.
- If we ever hash a payload with floats (e.g., a "confidence score" of `0.84`), this could produce different hashes on different runtimes. Mitigation: don't put non-integer numbers in payloads, or migrate to A when we need to.

Complexity: small (~15 LOC including unit tests for known inputs).
Forces into scope: a `canonicalize.ts` module and 2-3 unit tests pinning known input → known output.
Anti-features: regulator-defensible "we use RFC 8785" framing.

---

## Decision 4 — Hash chain state ownership during a run

### Option A — In-memory `RunAuditWriter` class

A class instance holds `lastHash` for the run, exposes `append(payload)`. Dies when the process ends.

Pros:
- Zero auxiliary I/O — the chain advances at the speed of one S3 PUT per record.
- Simplest possible implementation.
- Perfect fit for a smoke test (one process, one run, short-lived).

Cons:
- If the process crashes mid-run, the next process cannot resume the chain without scanning Object Storage.
- For Sprint 4's full agent loop running in a Next.js API route, "process restart" is a real possibility (deploy, OOM, hot reload during dev).

Complexity: small.
Forces into scope: a stateful class with a clear lifecycle. The smoke test instantiates one writer for the run and discards it.
Anti-features: crash recovery, multi-process correctness.

### Option B — Persist `_HEAD.json` per run

Every `append()` does two writes: the record itself, then `audit/{runId}/_HEAD.json` overwritten with the latest hash. The next process reads `_HEAD.json` to resume.

Pros:
- Crash-resumable.
- The UI can show "latest hash" with one read instead of a list-and-scan.

Cons:
- Doubles write count → doubles cost and latency.
- `_HEAD.json` is mutable, which contradicts the rest of the audit log's immutability story (Vultr has no versioning, so an overwrite is destructive).
- A tampered `_HEAD.json` could re-point the chain to a forged tip; the only defense is to re-derive it from the actual records, at which point you didn't need `_HEAD.json` in the first place.

Complexity: medium.
Forces into scope: an explicit mutable-pointer convention and the discipline of treating `_HEAD.json` as a non-authoritative cache.
Anti-features: a clean immutability story.

### Option C — List bucket and re-derive on every write

Every `append()` first lists `audit/{runId}/`, picks the lexicographically-greatest key, fetches its hash, then writes the new record.

Pros:
- Zero auxiliary state. The bucket IS the state.
- Crash-resumable for free.

Cons:
- A list-and-fetch round trip on every write — slow, especially as `runId` accumulates records.
- Race condition: two concurrent writers could both list, both fetch, both compute the same `previousHash`, both write — chain forks. (Mitigation: agent loop is single-writer per run by design, so this is theoretical.)

Complexity: medium.
Forces into scope: list-objects-v2 plumbing earlier than needed.
Anti-features: write latency that scales with chain length.

---

## Decision 5 — Smoke test execution model

### Option A — Standalone script `pnpm smoke`

A TypeScript script under `apps/web/scripts/smoke.ts` (or `scripts/smoke.ts` at repo root), invoked via a root-level `pnpm smoke` that runs through `tsx` or `node --import tsx`. Loads `.env.local`, runs the end-to-end flow, prints structured output, exits 0/1.

Pros:
- Best operator ergonomics: one command, clear output, easy to re-run during demo prep.
- Doesn't enter CI's pipeline yet, so we don't pay Vultr credits on every push or have to put Vultr secrets in GitHub Actions on Day 2.
- Fits the stack rule "Workspace packages do not read `process.env` directly" — the script is the entry point that reads env and passes config into constructors.

Cons:
- No CI guarantee that the smoke path keeps working. Mitigation: when Sprint 4 records VCR-style LLM fixtures, the fixture-replay version becomes the CI smoke test (per `stack.md` testing pyramid).
- A separate script means a separate place to maintain the wiring code.

Complexity: small.
Forces into scope: one root script entry, one new dev dependency (`tsx` or similar), a `pnpm smoke` script in the root `package.json`.
Anti-features: live-Vultr CI verification.

### Option B — Vitest test hitting real Vultr

A test in `packages/audit/src/smoke.test.ts` (or similar) that runs the live flow.

Pros:
- Integrates with `pnpm -r test` and CI naturally.
- Uses existing Vitest infrastructure.

Cons:
- Runs on every `pnpm test` invocation — including unrelated work — and consumes Vultr credits each time.
- Requires Vultr credentials in CI from Day 2, which is premature.
- Vitest's test reporter is the wrong shape for "demo prep verification"; the operator wants a clear narrative output, not a `✓/✗` per assertion.

Complexity: small.
Forces into scope: Vultr secrets in GitHub Actions; a way to skip the test when secrets aren't present (a `describe.skipIf` pattern).
Anti-features: cheap re-runs.

### Option C — Next.js API route `/api/smoke`

The smoke test runs server-side when hit via `curl` or browser.

Pros:
- Tests the same runtime path Sprint 4's planner will use (Next.js API route + Vultr SDKs).
- Easy demo-time verification on the deployed VPS.

Cons:
- Couples the smoke test to the Next.js app — can't run the smoke test from a clean clone without `pnpm dev` running.
- The operator has to manually trigger and read output from HTTP, which is awkward for CI later.
- The Next.js runtime adds layers between the test and the integration we're trying to validate.

Complexity: medium.
Forces into scope: an API route, request/response plumbing, an environment-variable check at route-entry time.
Anti-features: simplicity.

### Option D — Script for runner + Vitest wrapper for CI

Both A and B: the script is the operator-facing entry, and a Vitest test replays a captured fixture in CI.

Pros:
- Best of both worlds — eventually.

Cons:
- Premature. We don't have a fixture format yet; capturing one before Sprint 4's planner shape is settled is wasted work.

Complexity: medium.
Forces into scope: a VCR-style fixture format and a recorder. Both are real Sprint 4+ artifacts.
Anti-features: Sprint 2 scope discipline.

---

## Decision 6 — Object key naming

### Option A — `audit/{runId}/{ts}-{hash}.json`

Timestamp prefix (ISO-8601 millisecond UTC, e.g., `2026-05-14T18:32:11.482Z`) for natural sort, hash suffix for content-addressability.

Pros:
- Matches the documented pattern in `.claude/rules/vultr.md` lines 58 and 72 — adopting it here means the rules file stays accurate.
- Sortable: a list-objects-v2 with no `Prefix` walker scans records in chronological order without an extra sort step.
- Collision-safe: two records with the same `ts` (sub-ms simultaneity) have different hashes (different content), so different keys.
- Out-of-order writes are visible: if you list and the timestamps don't monotonically increase, something is wrong.

Cons:
- ISO-8601 strings in S3 keys contain `:` characters, which are legal in S3 keys but ugly in URLs and require percent-encoding when accessed via HTTP. Mitigation: replace `:` with `-` in the key (e.g., `2026-05-14T18-32-11.482Z-{hash}.json`).

Complexity: small.
Forces into scope: a key-formatting helper.
Anti-features: pure content-addressability (the key is partly time-based, so the same content written at two times produces two keys — but this is a feature, not a bug, for an append-only log).

### Option B — Pure content-addressed `audit/{runId}/{hash}.json`

Just the hash. No timestamp in the key.

Pros:
- Idempotent: writing the same content twice is a no-op at the object-store level.
- Simplest possible key.

Cons:
- No natural sort. Listing the bucket returns records in lexicographic-hash order, which is meaningless. To reconstruct chain order, you must read every record and walk the `previousHash` graph.
- Operationally painful during debugging — there's no way to tell "what was the third record in this run?" from a bucket listing alone.

Complexity: small.
Forces into scope: an in-memory chain-walker for any UI that shows ordered records.
Anti-features: human-readable bucket listings.

### Option C — `audit/{runId}/{sequence}-{hash}.json`

Explicit zero-padded sequence number (`000001`, `000002`, ...).

Pros:
- Sortable and obviously ordered.
- A gap in the sequence is a clear signal of a missing record.

Cons:
- The writer must track sequence per run, which is the same state-ownership problem as Decision 4. Sequence and `previousHash` are duplicate state.
- A tampered sequence number is undetectable unless cross-checked against the chain, so the sequence adds no security.

Complexity: medium.
Forces into scope: a sequence counter inside `RunAuditWriter`.
Anti-features: minimalism.

---

## Open questions

1. **Audit envelope scope (Decision 1):** are you comfortable locking the integrity envelope now and treating `payload` as `unknown` until Sprint 3, or do you want the full discriminated union defined in Sprint 2?
2. **Genesis constant string (Decision 2):** if Option A, do you want `roguemouse-audit-genesis-v1` as the seed string, or something else? (The string is committed in code and quoted in the README's audit-integrity disclosure, so it has minor branding value.)
3. **Canonicalizer dependency posture (Decision 3):** zero-dependency rolled-own, or pin an MIT-licensed RFC 8785 implementation now and never revisit?
4. **Smoke runner location (Decision 5):** if Option A, do you want the script under `apps/web/scripts/smoke.ts` (so it lives near the only consumer that matters) or at repo root `scripts/smoke.ts` (so it's clearly cross-package)?
5. **`.env.local` provisioning:** the smoke test needs three live secrets (`VULTR_INFERENCE_API_KEY`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`). Will you populate `.env.local` from the password manager before /implement, or do you want the script to fail fast with a clear "missing env var X" message?
6. **Failure semantics:** if the smoke test fails partway (e.g., chat completion succeeds, write succeeds, read-back returns mismatched bytes), what's the expected operator response — fix and re-run, or capture the failure as evidence and continue? Affects how loud the script's output is.

---

## Recommendation

For each of the six decisions, I'd recommend the option below. The throughline is: lock the cryptographic shape and the documented patterns, defer everything else.

- **Decision 1 — schema shape: Option A** (core integrity envelope + `recordType: string` + `payload: unknown`). It's the smallest schema that pre-paves Sprint 3's discriminated-union upgrade without breaking changes. We avoid designing the `chat_completion` payload shape before Sprint 4 tells us what it actually needs, and the smoke test exercises every integrity field of the envelope with whatever payload it likes.

- **Decision 2 — genesis: Option A** (hardcoded versioned constant `sha256("roguemouse-audit-genesis-v1")`). It's detectable, debuggable, version-extensible, and the verifier is one comparison. Cross-run chaining isn't needed in any scenario we've scoped.

- **Decision 3 — canonicalization: Option B** (rolled-own ~15-line recursive key-sort + `JSON.stringify`). For Sprint 2's payloads (strings, integers, plain objects) it's correct, zero-dependency, and trivially auditable. We add a 2-3 line `tasks/todo.md` entry to migrate to RFC 8785 if we ever serialize non-integer numbers or Unicode-sensitive strings into the audit log.

- **Decision 4 — chain state: Option A** (in-memory `RunAuditWriter`). For a single-process smoke test it's the obviously correct choice. Sprint 4 reconsiders when the agent loop runs inside a Next.js API route with multi-request lifetime; the recommendation there will likely still be in-memory per-run with optional `_HEAD.json` write at run-end for UI display, but that's a Sprint 4 design.

- **Decision 5 — execution model: Option A** (standalone `pnpm smoke` script under `apps/web/scripts/smoke.ts`). It's the cleanest operator experience for demo prep, doesn't burn Vultr credits or require GitHub Actions secrets on Day 2, and the path to a CI replay test (Option D's right half) opens up naturally in Sprint 4 once we have fixtures.

- **Decision 6 — object key: Option A** with `:` replaced by `-` in the timestamp portion: `audit/{runId}/{ts-safe}-{hash}.json`. It matches the documented vultr.md pattern (so the rules file stays accurate), gives natural chronological listing, and avoids URL-encoding pain. Pure content-addressability and explicit sequence numbers are both worse on the operational ergonomics that matter when we're debugging a flaky Sprint 4 run at 2am.
