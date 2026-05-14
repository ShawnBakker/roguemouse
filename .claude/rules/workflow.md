# Workflow rules

## The development protocol — non-negotiable

Every feature, architectural change, or non-trivial fix follows this 5-stage workflow:
/brainstorm  →  /spec-task  →  /plan-task  →  /implement-task  →  /review-task

Each stage produces one document in `docs/sprints/[feature-name]/`:
- `/brainstorm` → `brainstorm.md`
- `/spec-task` → `spec.md`
- `/plan-task` → `plan.md`
- `/implement-task` → produces code, no doc (the implementation IS the artifact)
- `/review-task` → `review.md`

**Each stage ends with an explicit STOP gate.** Do not proceed to the next stage without operator approval.

**Do not skip stages.** Jumping from problem statement to implementation produces code that's hard to review, hard to revert, and hard to explain in the demo video.

### Compressed workflow for trivial changes

If the change is:
- A typo or copy edit
- A single-line dependency bump
- A purely cosmetic CSS/styling change

Then the workflow compresses to: edit, typecheck, commit. No spec, no plan, no review.

If the change touches:
- The agent loop, voices, or prompts
- Tool schemas or audit record format
- Inference client error handling
- Vultr Object Storage or Serverless Inference integration
- Anything user-facing (UI, audit log viewer, proposal cards)

Then the full 5-stage protocol is mandatory.

## Session start ritual

At the start of every Claude Code session, read these files in order:

1. `CLAUDE.md`
2. `.claude/rules/workflow.md` (this file)
3. `.claude/rules/stack.md`
4. `.claude/rules/vultr.md`
5. `.claude/rules/hackathon.md`
6. `tasks/lessons.md`
7. `ROGUEMOUSE_CONTEXT.md`

The first instruction in every session prompt should be "Read the session-start files before doing anything else."

## tasks/lessons.md

This file starts empty. Whenever the operator corrects a mistake — a wrong assumption, a bad pattern, a deprecated API — write the correction into `tasks/lessons.md` as a new entry.

Entry format:
```markdown
## [Date] — [Short title]

**Wrong assumption**: [what was believed]
**Correction**: [what is actually true]
**Where this matters**: [files or patterns this rule applies to]
**Detection**: [how to detect this anti-pattern in code review]
```

Every `/plan-task` invocation must read `tasks/lessons.md` and explicitly list which anti-patterns the plan avoids.

## tasks/todo.md

When you notice something worth fixing that's outside the scope of the current task, write it to `tasks/todo.md` instead of fixing it.

Entry format:
```markdown
## [Date] — [Short title]
[1–2 sentences describing the issue or improvement]
File(s): [paths]
Priority: low | medium | high
```

Never refactor opportunistically. Stay in scope. The todo list captures ideas without polluting the current change.

## Pre-existing errors

If `pnpm -r typecheck` shows errors when you start a session, those are pre-existing. **Do not fix them as a side effect of unrelated work.** The baseline error count is the number to maintain. New errors are blockers; existing errors are deferred to a future dedicated sprint.

The same applies to test failures. If a test was already failing, it stays failing. The baseline failure count is the number to maintain.

## Minimal impact

Only touch files directly in scope for the task. The plan specifies what files are in scope; anything outside that list is out of scope.

If you find a bug while implementing: write it to `tasks/todo.md` and leave it alone.

If you find an opportunity to refactor: write it to `tasks/todo.md` and leave it alone.

Opportunistic refactoring during feature work produces commits that are hard to review and hard to revert. Resist the urge.

## Elegance check

For non-trivial changes: before presenting the implementation, pause and ask "is there a simpler solution that satisfies all the acceptance criteria?"

If yes, prefer the simpler solution and note the alternative considered in the implementation report.

Skip this check for obvious one-line fixes.

## Session end

Before ending any session:

1. If `ROGUEMOUSE_CONTEXT.md` changed (new resources, model rotations, sprint state changes), commit the updated version. This is the file that carries state across sessions.

2. If `tasks/lessons.md` or `tasks/todo.md` gained new entries during this session, commit those updates.

3. If a sprint is mid-flight (e.g., spec done but not yet implemented), note the current stage and next action at the end of the implementation/review report.

## Commit conventions

- Use Conventional Commits format: `type(scope): description`
- Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`
- Scope is optional but recommended for multi-package commits
- Keep the subject line under 72 characters
- Use the body to explain *why*, not *what* (the diff shows what)

Examples:
- `feat(agent): add Risk Officer voice with Gemini Pro integration`
- `fix(audit): correct hash chain ordering after async writes`
- `docs(sprint): close sprint-01-smoke-test with review`
- `chore(deps): bump @aws-sdk/client-s3 to 3.700.0`
