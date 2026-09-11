// Stage 3 — assemble kb/pages/*.md into the stuffed kb/manual.md and kb/manifest.json.
// Pure, local, and byte-deterministic: same page inputs → identical output bytes.
import fs from "node:fs";
import path from "node:path";
import {
  DOCS,
  PAGES_DIR,
  MANUAL_MD,
  MANIFEST_JSON,
  PRODUCT,
  CURATE_THRESHOLD,
  MAX_CURATED,
  ALWAYS_CURATE_CONTENT_TYPES,
  ALWAYS_CURATE_TAGS,
  type PageRecord,
} from "./config.ts";
import {
  ensureDir,
  exists,
  log,
  parsePageFile,
  rel,
  sha256,
  stableStringify,
  step,
} from "./util.ts";

/** Reading order: by document, then page. */
function readingOrder(records: PageRecord[]): PageRecord[] {
  return [...records].sort((a, b) => a.docOrder - b.docOrder || a.page - b.page);
}

/** Load every committed page record in reading order. */
export function loadPages(): PageRecord[] {
  if (!exists(PAGES_DIR)) return [];
  const records: PageRecord[] = [];
  for (const file of fs.readdirSync(PAGES_DIR)) {
    if (!file.endsWith(".md")) continue;
    records.push(parsePageFile(fs.readFileSync(path.join(PAGES_DIR, file), "utf8")));
  }
  return readingOrder(records);
}

/** Decide which page images are stuffed into the system prompt (see EXTRACTION.md). */
export function computeCurated(pages: PageRecord[]): Set<string> {
  const isAlways = (p: PageRecord): boolean =>
    p.doc === "selection-chart" ||
    p.content_types.some((c) => ALWAYS_CURATE_CONTENT_TYPES.has(c)) ||
    p.tags.some((t) => ALWAYS_CURATE_TAGS.has(t));

  const candidates = pages.filter((p) => isAlways(p) || p.visual_importance >= CURATE_THRESHOLD);
  candidates.sort(
    (a, b) =>
      Number(isAlways(b)) - Number(isAlways(a)) ||
      b.visual_importance - a.visual_importance ||
      a.docOrder - b.docOrder ||
      a.page - b.page,
  );

  // Keep every always-include page even past the cap; fill remaining slots by importance.
  const chosen = new Set<string>();
  for (const p of candidates) if (isAlways(p)) chosen.add(p.id);
  for (const p of candidates) {
    if (chosen.size >= MAX_CURATED) break;
    chosen.add(p.id);
  }
  return chosen;
}

/** Build the stuffed manual.md string (deterministic: no timestamps/paths, stable order). */
export function buildManual(unordered: PageRecord[]): string {
  const pages = readingOrder(unordered);
  const out: string[] = [];
  out.push(`# ${PRODUCT} — Complete Manual (extracted knowledge base)`);
  out.push(
    "",
    "> Auto-generated from the source PDFs by the extraction pipeline (see docs/EXTRACTION.md).",
    "> Each section below is one manual page, transcribed verbatim with every table and figure",
    `> described in words. Cite pages to the user as, e.g., *(Owner's Manual p.12)*. Page images`,
    "> can be surfaced with the get_page_image tool using the id in each section heading.",
    "",
    "## Contents",
    "",
  );
  for (const p of pages) {
    out.push(`- [${p.docTitle} p.${p.page} — ${p.section_title}](#${p.id})`);
  }

  let currentDoc = "";
  for (const p of pages) {
    if (p.doc !== currentDoc) {
      currentDoc = p.doc;
      out.push("", "---", "", `# ${p.docTitle}`);
    }
    out.push(
      "",
      `## ${p.docTitle} — Page ${p.page} {#${p.id}}`,
      `<!-- id: ${p.id} · image: ${p.image} -->`,
      "",
      p.markdown.trim(),
    );
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Build the manifest object (runtime index + curation flags + manual.md hash). */
export function buildManifest(unordered: PageRecord[], manual: string): Record<string, unknown> {
  const pages = readingOrder(unordered);
  const curated = computeCurated(pages);
  const byDoc = DOCS.map((d) => ({
    slug: d.slug,
    title: d.title,
    pdf: `files/${d.pdf}`,
    pageCount: pages.filter((p) => p.doc === d.slug).length,
  })).filter((d) => d.pageCount > 0);

  return {
    schemaVersion: 1,
    product: PRODUCT,
    manual: rel(MANUAL_MD),
    manualChars: manual.length,
    manualSha256: sha256(manual),
    pageCount: pages.length,
    curatedImageCount: curated.size,
    curatedImages: pages.filter((p) => curated.has(p.id)).map((p) => p.id),
    documents: byDoc,
    pages: pages.map((p) => ({
      id: p.id,
      doc: p.doc,
      docTitle: p.docTitle,
      page: p.page,
      image: p.image,
      markdown: rel(path.join(PAGES_DIR, `${p.id}.md`)),
      sectionTitle: p.section_title,
      summary: p.summary,
      contentTypes: p.content_types,
      figures: p.figures,
      tags: p.tags,
      visualImportance: p.visual_importance,
      curated: curated.has(p.id),
    })),
  };
}

/** Write manual.md + manifest.json from the committed page records. */
export function bundle(): { pageCount: number; curated: number; sha: string } {
  step("Bundle → kb/manual.md + kb/manifest.json");
  const pages = loadPages();
  if (pages.length === 0) {
    throw new Error("no pages found in kb/pages — run 'extract' first");
  }
  const manual = buildManual(pages);
  const manifest = buildManifest(pages, manual);

  ensureDir(path.dirname(MANUAL_MD));
  fs.writeFileSync(MANUAL_MD, manual);
  fs.writeFileSync(MANIFEST_JSON, stableStringify(manifest));

  const curated = manifest.curatedImageCount as number;
  const sha = manifest.manualSha256 as string;
  log(`  pages: ${pages.length}`);
  log(`  manual.md: ${manual.length} chars, sha256 ${sha.slice(0, 12)}…`);
  log(`  curated images (stuffed): ${curated} → ${(manifest.curatedImages as string[]).join(", ")}`);
  return { pageCount: pages.length, curated, sha };
}
