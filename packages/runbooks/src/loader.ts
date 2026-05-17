import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type LoadedRunbook = {
  path: string;
  rawContent: string;
  excerpt: string;
};

const WHEN_THIS_FIRES_REGEX = /## When this fires\s*\n+([\s\S]+?)(?=\n## |$)/;

function extractExcerpt(rawContent: string, filename: string): string {
  const match = rawContent.match(WHEN_THIS_FIRES_REGEX);
  if (!match || typeof match[1] !== "string") {
    throw new Error(
      `Runbook missing 'When this fires' section: ${filename}`,
    );
  }
  const collapsed = match[1].replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) {
    throw new Error(
      `Runbook 'When this fires' section is empty: ${filename}`,
    );
  }
  return collapsed;
}

/**
 * Read every `.md` file under `contentDir`, extract its
 * "When this fires" excerpt, and return them sorted by path.
 *
 * Fails fast on:
 *  - directory read errors
 *  - any file lacking a non-empty "## When this fires" section
 */
export async function loadRunbookCorpus(
  contentDir: string,
): Promise<LoadedRunbook[]> {
  let entries: string[];
  try {
    entries = await readdir(contentDir);
  } catch (err) {
    throw new Error(
      `Runbook corpus directory read failed: ${contentDir} — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const markdownFiles = entries.filter((name) => name.endsWith(".md")).sort();

  const loaded: LoadedRunbook[] = [];
  for (const filename of markdownFiles) {
    const filePath = path.join(contentDir, filename);
    const rawContent = await readFile(filePath, "utf-8");
    const excerpt = extractExcerpt(rawContent, filePath);
    loaded.push({ path: filePath, rawContent, excerpt });
  }

  return loaded;
}
