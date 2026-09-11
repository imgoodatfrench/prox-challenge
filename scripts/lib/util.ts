// Small dependency-free helpers: logging, .env loading, fs, concurrency,
// deterministic JSON, and the kb/pages/<id>.md (meta + body) file format.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT, PAGES_DIR, type PageRecord } from "./config.ts";

// --- logging ---
export const log = (...a: unknown[]) => console.log(...a);
export const warn = (...a: unknown[]) => console.warn("!", ...a);
export const step = (msg: string) => console.log(`\n=== ${msg} ===`);

// --- fs ---
export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
export function exists(p: string): boolean {
  return fs.existsSync(p);
}
/** Path relative to repo root, with forward slashes (stable across OSes). */
export function rel(p: string): string {
  return path.relative(ROOT, p).split(path.sep).join("/");
}

export const pad2 = (n: number): string => String(n).padStart(2, "0");
export const pageId = (slug: string, page: number): string => `${slug}-p${pad2(page)}`;

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * Deterministic JSON: object keys sorted recursively, arrays kept in order,
 * 2-space indent, trailing newline. Byte-stable across runs.
 */
export function stableStringify(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = sort((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value), null, 2) + "\n";
}

/** Minimal .env loader (KEY=VALUE lines). Never overrides an already-set var. */
export function loadDotEnv(): void {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

/** Run `fn` over `items` with at most `concurrency` in flight, preserving input order. */
export async function pool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// --- kb/pages/<id>.md file format: a JSON meta comment then the markdown body ---
const META_OPEN = "<!--prox:meta";
const META_CLOSE = "prox:meta-->";

/** Serialize a page record to the `<id>.md` on-disk form (meta header + body). */
export function serializePageFile(record: PageRecord): string {
  const { markdown, ...meta } = record;
  return `${META_OPEN}\n${stableStringify(meta)}${META_CLOSE}\n\n${markdown.trim()}\n`;
}

/** Parse an `<id>.md` file back into a page record. */
export function parsePageFile(text: string): PageRecord {
  const re = new RegExp(`^${META_OPEN}\\n([\\s\\S]*?)\\n${META_CLOSE}\\n\\n([\\s\\S]*)$`);
  const m = text.match(re);
  if (!m) throw new Error("page file missing prox:meta header");
  const meta = JSON.parse(m[1]) as Omit<PageRecord, "markdown">;
  return { ...meta, markdown: m[2].replace(/\n+$/, "") };
}

export function writePageFile(id: string, record: PageRecord): void {
  ensureDir(PAGES_DIR);
  fs.writeFileSync(path.join(PAGES_DIR, `${id}.md`), serializePageFile(record));
}

export function readPageFile(id: string): PageRecord {
  return parsePageFile(fs.readFileSync(path.join(PAGES_DIR, `${id}.md`), "utf8"));
}

export function pageFileExists(id: string): boolean {
  return fs.existsSync(path.join(PAGES_DIR, `${id}.md`));
}
