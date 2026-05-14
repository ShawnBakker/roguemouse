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
