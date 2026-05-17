import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadRunbookCorpus } from "../loader.js";

const VALID_RUNBOOK = `# Test Runbook

## When this fires

This alert fires when something specific happens in production.

## Diagnostic steps

1. Step one.
2. Step two.

## Mitigation

1. Fix it.
`;

const MULTILINE_EXCERPT_RUNBOOK = `# Multi-Paragraph Test

## When this fires

First sentence of the section.
Second sentence on a new line, same paragraph.
Third sentence finishing the paragraph.

## Diagnostic steps

1. Step.
`;

const NO_SECTION_RUNBOOK = `# Missing Section

## Overview

This runbook does not have the required heading.
`;

describe("loadRunbookCorpus", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "rgm-rb-loader-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads a single valid runbook and extracts the excerpt", async () => {
    await writeFile(path.join(tempDir, "a.md"), VALID_RUNBOOK, "utf-8");

    const result = await loadRunbookCorpus(tempDir);

    expect(result).toHaveLength(1);
    expect(result[0]?.excerpt).toBe(
      "This alert fires when something specific happens in production.",
    );
  });

  it("collapses multi-line excerpts to a single whitespace-normalized line", async () => {
    await writeFile(
      path.join(tempDir, "multi.md"),
      MULTILINE_EXCERPT_RUNBOOK,
      "utf-8",
    );

    const result = await loadRunbookCorpus(tempDir);

    expect(result[0]?.excerpt).toBe(
      "First sentence of the section. Second sentence on a new line, same paragraph. Third sentence finishing the paragraph.",
    );
  });

  it("throws naming the file when 'When this fires' section is missing", async () => {
    await writeFile(path.join(tempDir, "bad.md"), NO_SECTION_RUNBOOK, "utf-8");

    await expect(loadRunbookCorpus(tempDir)).rejects.toThrow(
      /Runbook missing 'When this fires' section/,
    );
    await expect(loadRunbookCorpus(tempDir)).rejects.toThrow(/bad\.md/);
  });

  it("returns runbooks sorted by path (stable for tie-break)", async () => {
    await writeFile(path.join(tempDir, "b.md"), VALID_RUNBOOK, "utf-8");
    await writeFile(path.join(tempDir, "a.md"), VALID_RUNBOOK, "utf-8");
    await writeFile(path.join(tempDir, "c.md"), VALID_RUNBOOK, "utf-8");

    const result = await loadRunbookCorpus(tempDir);

    expect(result.map((r) => path.basename(r.path))).toEqual([
      "a.md",
      "b.md",
      "c.md",
    ]);
  });

  it("ignores non-markdown files in the directory", async () => {
    await writeFile(path.join(tempDir, "a.md"), VALID_RUNBOOK, "utf-8");
    await writeFile(path.join(tempDir, "README.txt"), "not markdown", "utf-8");

    const result = await loadRunbookCorpus(tempDir);

    expect(result).toHaveLength(1);
  });

  it("throws a clear error when the directory does not exist", async () => {
    const missing = path.join(tempDir, "nonexistent");

    await expect(loadRunbookCorpus(missing)).rejects.toThrow(
      /Runbook corpus directory read failed/,
    );
  });
});
