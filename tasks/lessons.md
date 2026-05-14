# Lessons

This file accumulates anti-patterns discovered during the Roguemouse build. Each entry is a correction from a real mistake — a wrong assumption, a deprecated API, a confusing pattern that produced subtle bugs.

**Every `/plan-task` invocation must read this file** and explicitly list which anti-patterns the plan avoids.

This file starts empty. The first entry will arrive when the first correction is made.

---

## Entry template

```markdown
## YYYY-MM-DD — Short title

**Wrong assumption**: What was believed (incorrectly).

**Correction**: What is actually true.

**Where this matters**: Files, packages, or patterns this rule applies to.

**Detection**: How to detect this anti-pattern in code review (grep pattern, specific symptom, etc.).
```

---
