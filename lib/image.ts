import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";

// Where the extraction pipeline writes page PNGs and its index.
const KB_DIR = join(process.cwd(), "kb");
const IMAGES_DIR = join(KB_DIR, "images");
const MANIFEST_PATH = join(KB_DIR, "manifest.json");

// Known source docs, in reading order. Slugs match the extraction pipeline
// (scripts/lib/config.ts) and the PNG filenames: `<slug>-p<NN>.png`.
const DOC_TITLES: Record<string, string> = {
  "owner-manual": "Owner's Manual",
  "quick-start-guide": "Quick Start Guide",
  "selection-chart": "Welder Selection Chart",
};
const DEFAULT_DOC = "owner-manual";

export interface ManifestPage {
  id: string;
  doc: string;
  docTitle: string;
  page: number;
  image: string;
  sectionTitle?: string;
  summary?: string;
  contentTypes?: string[];
  tags?: string[];
  curated?: boolean;
}

interface Manifest {
  pages?: ManifestPage[];
  curatedImages?: string[];
}

let manifestCache: Manifest | null | undefined;

/** Load kb/manifest.json if the ingest step has produced it (else null). */
export function loadManifest(): Manifest | null {
  if (manifestCache !== undefined) return manifestCache;
  manifestCache = existsSync(MANIFEST_PATH)
    ? (JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest)
    : null;
  return manifestCache;
}

export interface ResolvedImage {
  id: string;
  doc: string;
  docTitle: string;
  page: number;
  /** absolute path to the PNG on disk */
  absPath: string;
  exists: boolean;
  mimeType: "image/png";
}

/** Build a page id from a doc slug + page number, matching PNG filenames. */
function pageId(doc: string, page: number): string {
  return `${doc}-p${String(page).padStart(2, "0")}`;
}

/**
 * Resolve a page reference (an explicit id like "owner-manual-p12", or a
 * doc slug + page number) to an on-disk PNG. Guards against path traversal:
 * the resolved file must sit inside kb/images.
 */
export function resolvePageImage(ref: {
  id?: string;
  doc?: string;
  page?: number;
}): ResolvedImage | null {
  const rawId = ref.id?.trim();
  let doc: string;
  let page: number;

  if (rawId) {
    // id shape: "<slug>-p<NN>" — split on the final "-p".
    const m = rawId.match(/^(.*)-p(\d{1,3})$/);
    if (!m) return null;
    doc = m[1];
    page = Number(m[2]);
  } else {
    if (ref.page == null || !Number.isFinite(ref.page)) return null;
    doc = (ref.doc || DEFAULT_DOC).trim();
    page = Math.trunc(ref.page);
  }

  if (!DOC_TITLES[doc] || page < 1 || page > 999) return null;

  // Always rebuild the canonical, zero-padded id so a model-supplied id like
  // "owner-manual-p5" resolves to the on-disk "owner-manual-p05.png".
  const id = pageId(doc, page);
  const filename = `${id}.png`;
  const absPath = resolve(IMAGES_DIR, filename);
  // Path-traversal guard: must remain directly inside IMAGES_DIR.
  if (absPath !== join(IMAGES_DIR, filename) || !absPath.startsWith(IMAGES_DIR + sep)) {
    return null;
  }

  return {
    id,
    doc,
    docTitle: DOC_TITLES[doc],
    page,
    absPath,
    exists: existsSync(absPath),
    mimeType: "image/png",
  };
}

/** Read a resolved PNG as base64 (for handing image bytes to the model). */
export function readImageBase64(img: ResolvedImage): string {
  return readFileSync(img.absPath).toString("base64");
}

/** List available page ids (from disk) — used to sanity-check tool calls. */
export function listAvailablePageIds(): string[] {
  if (!existsSync(IMAGES_DIR)) return [];
  return readdirSync(IMAGES_DIR)
    .filter((f) => f.endsWith(".png"))
    .map((f) => f.replace(/\.png$/, ""))
    .sort();
}
