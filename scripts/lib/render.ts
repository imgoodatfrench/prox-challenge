// Stage 1 — render each PDF page to a PNG with ghostscript. Local, no API key,
// byte-deterministic across runs.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  DOCS,
  FILES_DIR,
  IMAGES_DIR,
  DEFAULT_DPI,
  type DocConfig,
} from "./config.ts";
import { ensureDir, exists, log, pageId, rel, step, warn } from "./util.ts";

function gs(args: string[]): { ok: boolean; stderr: string } {
  const r = spawnSync("gs", args, { encoding: "utf8" });
  if (r.error) {
    throw new Error(
      `ghostscript ('gs') not found or failed to launch: ${r.error.message}\n` +
        `Install it (macOS: 'brew install ghostscript').`,
    );
  }
  return { ok: r.status === 0, stderr: r.stderr ?? "" };
}

/** Number of pages in a PDF, via ghostscript's pdfpagecount. */
export function pageCount(pdfPath: string): number {
  const r = spawnSync(
    "gs",
    [
      "-q",
      "-dNODISPLAY",
      "-dNOSAFER",
      "-c",
      `(${pdfPath}) (r) file runpdfbegin pdfpagecount = quit`,
    ],
    { encoding: "utf8" },
  );
  const n = parseInt((r.stdout ?? "").trim(), 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`could not read page count for ${pdfPath}: ${r.stderr}`);
  }
  return n;
}

/** Render one page to kb/images/<id>.png. Returns the repo-relative image path. */
export function renderPage(doc: DocConfig, page: number, dpi: number): string {
  ensureDir(IMAGES_DIR);
  const id = pageId(doc.slug, page);
  const out = path.join(IMAGES_DIR, `${id}.png`);
  const { ok, stderr } = gs([
    "-q",
    "-dNOPAUSE",
    "-dBATCH",
    "-dSAFER",
    "-sDEVICE=png16m",
    `-r${dpi}`,
    `-dFirstPage=${page}`,
    `-dLastPage=${page}`,
    "-o",
    out,
    path.join(FILES_DIR, doc.pdf),
  ]);
  if (!ok || !exists(out)) {
    throw new Error(`render failed for ${id}: ${stderr}`);
  }
  return rel(out);
}

export interface RenderOptions {
  force?: boolean;
  only?: string; // doc slug
  pages?: [number, number]; // inclusive 1-based range
  dpi?: number;
}

/** Render all (or a scoped subset of) pages. Returns the ids rendered this run. */
export function render(opts: RenderOptions = {}): string[] {
  const dpi = opts.dpi ?? DEFAULT_DPI;
  const docs = opts.only ? DOCS.filter((d) => d.slug === opts.only) : DOCS;
  if (opts.only && docs.length === 0) throw new Error(`unknown --only doc: ${opts.only}`);

  step(`Render → PNG @ ${dpi} DPI`);
  const rendered: string[] = [];
  for (const doc of docs) {
    const total = pageCount(path.join(FILES_DIR, doc.pdf));
    const [lo, hi] = opts.pages ?? [1, total];
    let done = 0;
    for (let p = Math.max(1, lo); p <= Math.min(total, hi); p++) {
      const id = pageId(doc.slug, p);
      const out = path.join(IMAGES_DIR, `${id}.png`);
      if (!opts.force && exists(out)) continue;
      renderPage(doc, p, dpi);
      rendered.push(id);
      done++;
    }
    const kb = (n: number) => Math.round(n / 1024);
    const sizes = fs
      .readdirSync(IMAGES_DIR)
      .filter((f) => f.startsWith(doc.slug + "-p"))
      .map((f) => fs.statSync(path.join(IMAGES_DIR, f)).size);
    const totalKb = kb(sizes.reduce((a, b) => a + b, 0));
    log(`  ${doc.slug}: ${done} rendered / ${total} pages (${totalKb} KB on disk)`);
  }
  if (rendered.length === 0) warn("nothing to render (use --force to re-render)");
  return rendered;
}
