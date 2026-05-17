# Lessons

This file accumulates anti-patterns discovered during the Roguemouse build. Each entry is a correction from a real mistake — a wrong assumption, a deprecated API, a confusing pattern that produced subtle bugs.

**Every `/plan-task` invocation must read this file** and explicitly list which anti-patterns the plan avoids.

---

## Entry template
YYYY-MM-DD — Short title
Wrong assumption: What was believed (incorrectly).
Correction: What is actually true.
Where this matters: Files, packages, or patterns this rule applies to.
Detection: How to detect this anti-pattern in code review (grep pattern, specific symptom, etc.).

---

## 2026-05-14 — Markdown wrappers strip leading hash and asterisk from fenced code blocks

**Wrong assumption**: Code blocks inside fenced markdown sections preserve their content verbatim when relayed through chat interfaces.

**Correction**: Some markdown renderers in the relay path interpret leading hash and asterisk characters inside fenced blocks as if they were markdown formatting (headings and emphasis), stripping them silently. This was observed when a .gitignore block was relayed through a chat-to-Claude-Code pipeline: 4 comment lines lost their leading hash and 4 glob patterns lost their leading asterisk.

**Where this matters**: Any operator prompt that includes file contents to be created verbatim, especially:
- .gitignore (uses hash comments and asterisk globs)
- Dockerfile and docker-compose.yml (use hash comments)
- Shell scripts (hash-bang shebangs, hash comments)
- TypeScript/JavaScript/Python that uses hash or asterisk symbolically

**Detection**: After Claude Code creates a file from prompt content, do a character-level diff against the source. Specifically check for missing comment markers (lines that should start with hash but start with content directly) and glob wildcards (entries that should start with asterisk but start with a literal extension). If the operator says "I had to repair this" or "I restored the missing prefixes," that is the signal — the prompt format failed somewhere in the relay.

**Mitigation in future prompts**: For files containing hash or asterisk at the start of lines, send the content as plain text rather than wrapped in a fenced markdown code block. If wrapping is necessary, prefer indented code blocks (4-space indent) over fenced (triple-backtick), since the former is less likely to be aggressively re-parsed. When in doubt, the operator should verify the on-disk file matches intent before committing.

---

## 2026-05-14 — Conditional package exports require invocation discipline

**Wrong assumption**: Adding a `development` condition to a package's `exports` field is sufficient to make TypeScript-runner tools (like tsx) resolve to source files in dev and built files in production.

**Correction**: Node's conditional-exports resolution only honors a fixed set of conditions by default (`node`, `import`, `require`, `default`). Custom condition names like `development`, `production`, `browser` require the consumer to set `--conditions=<name>` (via the Node CLI flag or `NODE_OPTIONS`) for the branch to be selected. Tools like tsx, tsc, and Vitest do not propagate custom conditions automatically. Without explicit configuration, custom conditions silently fall through to the `default` branch.

**Where this matters**: Any `exports` block that uses a condition key other than `node`, `import`, `require`, or `default`. Specifically the case where a workspace package wants to expose `./src/*.ts` to dev tooling and `./dist/*.js` to production consumers.

**Detection**: After adding a conditional exports block, verify by invoking the consuming tool without any extra flags and confirming the intended branch is selected. If `Cannot find module ...dist/index.js` appears when the dev branch was expected to win, the condition is not being honored.

**Mitigation**: Either (a) use unconditional exports `{ ".": "./src/index.ts" }` if dev/prod parity is acceptable, or (b) propagate the required `--conditions` flag through every consumer (via NODE_OPTIONS, cross-env, or per-tool config) and document the discipline. Option (a) is preferred when there's no concrete production-build requirement yet — it's the simplest invariant. Option (b) is justified only when the dev/prod split has a real downstream consumer that needs it.

---

## 2026-05-16 — Gemini OpenAI-compat shim translates RESOURCE_EXHAUSTED to HTTP 403-with-empty-body

**Wrong assumption**: A Gemini API key that successfully lists models via `/v1beta/models` and is recognized as authenticated by Google's auth layer will be able to make chat-completion calls against any model in the catalog through the OpenAI-compatibility endpoint, and any rejection will surface as an informative HTTP error.

**Correction**: When a Gemini API key has zero quota for a model (e.g., free-tier `gemini-2.5-pro` whose quota is `limit: 0`), the **native** Gemini endpoint (`/v1beta/models/.../generateContent`) returns HTTP 429 with a JSON error body detailing the quota violation (`RESOURCE_EXHAUSTED` with retry-after seconds and per-metric breakdown). The **OpenAI-compat** endpoint (`/v1beta/openai/chat/completions`) returns HTTP **403 with no response body** for the same condition. The classifier's status-based logic correctly marks the 403 as non-retryable, but the empty body provides no diagnostic detail — the failure looks like an auth issue rather than a quota issue.

**Where this matters**: any `@roguemouse/inference` call path that targets Gemini via the OpenAI-compat endpoint (`createGeminiClient` + `geminiChatCompletion`). The Vultr Serverless Inference endpoint does not exhibit this; this is specific to Google's compat shim.

**Detection**: any 403-empty inference error from a Gemini compat call should be cross-checked against the native endpoint with the same key+model before concluding "auth failure." The native endpoint is fail-loud; the compat endpoint is fail-silent for quota issues. Probe with `curl -H "x-goog-api-key: $KEY" "https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent"` (with a minimal request body) to extract the real `RESOURCE_EXHAUSTED` detail.

**Mitigation**: when an `InferenceError` from a Gemini call has `code: "http_403"` AND `message` is empty or trivially short, the diagnosis path is to test the same key against the native endpoint to confirm whether it's an auth or quota failure. Future Sprint 7 polish may add a Gemini-specific 403 handler that automatically probes the native endpoint and rewrites the error message; for now, the operator does this manually when 403-empty surfaces.

**Surfaced during**: Sprint 4a Phase 4 (Gemini integration smoke test).

---

## 2026-05-16 — Free-tier gemini-2.5-pro has limit: 0 quota

**Wrong assumption**: A Gemini model that appears in the API Studio model catalog response (`/v1beta/models?pageSize=10`) is callable by any valid API key — model visibility implies callability.

**Correction**: `gemini-2.5-pro` is visible in Google AI Studio's model catalog and is callable through the OpenAI-compat surface (returns 200 if quota allows). However, free-tier API keys are explicitly assigned **zero** quota for Pro models — both `generate_content_free_tier_input_token_count` and `generate_content_free_tier_requests` have `limit: 0`. Every request immediately hits `RESOURCE_EXHAUSTED` regardless of usage history. Model visibility is independent of model quota; the catalog lists what *exists*, not what *the key can use*.

**Where this matters**: `.env.local`'s `GEMINI_RISK_MODEL` value, and any future env var or hardcoded constant that names a specific Gemini model. Pro models (`gemini-2.5-pro`, presumably `gemini-3-pro` when available) require billing to be enabled on the Google Cloud project the key is tied to. Flash models (`gemini-2.5-flash`, `gemini-2.5-flash-lite`) and 2.0-era models have non-zero free-tier quotas.

**Detection**: before pinning a Gemini model in production code, verify the model's free-tier quota with a small test call or by checking Google Cloud Console's quota page for the project. Don't assume model visibility in the catalog implies callability. The first integration test against any new Gemini model should be considered a quota probe as much as a functionality probe.

**Mitigation paths**:
- (a) Enable billing on the Google Cloud project the key is tied to. This turns on paid-tier quota; `gemini-2.5-pro` becomes accessible. Pricing is reasonable for smoke-test frequency (~$0.003 per Sprint 4a-shaped run).
- (b) Use `gemini-2.5-flash` (non-zero free-tier quota; works as a capable Risk Officer / Synthesizer model). Sprint 4a chose this path. Sprint 7 polish may revisit (a) for demo-time Pro upgrade.

**Surfaced during**: Sprint 4a Phase 4 (Gemini integration smoke test).

---

## 2026-05-17 — Dispatcher recursion-guard test uses literal regex against source; comments cannot use the guarded patterns

**Wrong assumption**: The architectural recursion-guard test in `packages/agent/src/__tests__/dispatcher.test.ts` (which reads `dispatcher.ts` and counts literal pattern matches) was assumed to behave correctly regardless of where the patterns appeared — as long as they did not appear in executable code, the count would be zero.

**Correction**: The test uses plain regex matching against the raw file contents (`readFileSync` + `match`). It does NOT strip comments or JSDoc. A reference to the guarded patterns inside a comment will count toward the assertion, failing the test as if a recursion bug were present. This was discovered when the dispatcher's JSDoc contained the phrase `multiple dispatchTool(...) calls in parallel` and the test's `dispatchTool(` count was 1 instead of 0.

**Where this matters**: any source file with an architectural-grep test, currently `packages/agent/src/dispatcher.ts`. The guarded patterns are:
- `ctx.writer.append(` — must appear EXACTLY 2 times (the two tool-flow audit writes)
- `"audit:append"` — must appear 0 times (no string-literal reference)
- `dispatchTool(` — must appear 0 times (the function is defined, not called recursively from within itself)

**Detection**: if a future change to `dispatcher.ts` introduces any of these patterns — in a comment, JSDoc, type annotation, or actual code — the recursion-guard test fails. To audit, run `pnpm --filter @roguemouse/agent test` and check whether the architectural-guard suite passes.

**Mitigation**: if a comment legitimately needs to reference one of these names, rephrase to avoid the literal parens form. For example, `multiple dispatchTool(...) calls` → `multiple dispatch invocations`. The test is intentionally conservative: it catches real recursion bugs AND benign comment references; both require the author to think before re-introducing the pattern.

**Surfaced during**: Sprint 4b Phase 5 (dispatcher implementation, test case 9 on first run).
