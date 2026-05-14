---
description: Write the phased implementation plan for a specified feature.
---

# /plan-task

Use this command to convert an approved spec into a phased implementation plan with exact file targets. The plan describes **how** to build what the spec says.

## What to do

1. Read `docs/sprints/[feature-name]/spec.md` in full. If it does not exist, stop and tell the operator to run `/spec-task` first.

2. Read `tasks/lessons.md`. This file accumulates anti-patterns from past mistakes. Every plan must explicitly avoid the patterns listed there.

3. Read the current state of every file the plan will touch. **Do not rely on file contents from earlier in the session — re-read each file now.** Cite exact line numbers from the current state of the file.

4. Break the implementation into phases. A phase is a unit of work that:
   - Touches a coherent set of files
   - Ends with a verifiable state (typecheck passes, smoke test passes)
   - Can be independently reviewed and reverted

5. Each phase must specify:
   - **Files touched**: full paths and approximate line ranges
   - **Step-by-step instructions**: what changes, in what order
   - **Test strategy**: which tests must pass, what fixtures are needed
   - **Anti-patterns to avoid**: cite specific entries from `tasks/lessons.md`
   - **Phase exit criteria**: typecheck must pass with `pnpm -r typecheck`; smoke test must pass with `pnpm smoke`
   - **Rollback**: what to git-revert if this phase causes problems

## Output

Write the plan to `docs/sprints/[feature-name]/plan.md`.

Document structure:

```markdown
# [Feature Name] — Plan

## Reference docs
- Spec: `docs/sprints/[feature-name]/spec.md`
- Brainstorm: `docs/sprints/[feature-name]/brainstorm.md`

## Anti-patterns from tasks/lessons.md to avoid
- [pattern]: [how this plan avoids it]
- [pattern]: [how this plan avoids it]

## Phase 1 — [phase name]

### Files touched
- `apps/web/src/app/api/foo/route.ts` (lines L-L)
- `packages/agent/src/voices/foo.ts` (new file)

### Steps
1. [exact change]
2. [exact change]
3. [exact change]

### Test strategy
- Add fixture `fixtures/foo-scenario.json` with [seed data]
- Run `pnpm test --filter @roguemouse/agent` — must pass
- Run `pnpm smoke` — must pass

### Phase exit
- [ ] `pnpm -r typecheck` passes with no new errors
- [ ] `pnpm smoke` passes
- [ ] Git working tree contains only the changes from this phase

### Rollback
[exact git commands or steps to revert this phase]

## Phase 2 — [phase name]
[same structure]

## Final verification
After all phases complete, run:
- [ ] `pnpm -r typecheck` — clean
- [ ] `pnpm smoke` — passes
- [ ] All acceptance criteria from spec mapped to passing tests or manual verification steps
```

## Stop gate

When the plan is complete:
1. Report the file path
2. Summarize the phase count and the exit criteria for each phase
3. Stop

Do not begin implementation. Wait for explicit operator approval before running `/implement-task`.
