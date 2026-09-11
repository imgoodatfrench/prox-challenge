import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MANUAL_PATH = join(process.cwd(), "kb", "manual.md");

let cached: string | null = null;

/**
 * Loads the stuffed manual (kb/manual.md) produced by `npm run ingest`.
 * Read once and memoized so the exact same bytes go into every request's
 * system prompt — a byte-stable prefix is what lets prompt caching hit.
 */
export function loadManual(): string {
  if (cached !== null) return cached;

  if (!existsSync(MANUAL_PATH)) {
    throw new Error(
      "kb/manual.md not found. Run `npm run ingest` once (needs ANTHROPIC_API_KEY) " +
        "to extract the manuals into kb/manual.md before starting the server.",
    );
  }

  cached = readFileSync(MANUAL_PATH, "utf8");
  return cached;
}

export function manualExists(): boolean {
  return existsSync(MANUAL_PATH);
}
