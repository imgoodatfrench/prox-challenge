// Central config + shared types for the extraction pipeline.
// Paths resolve from scripts/lib/*.ts up to the repo root.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export const FILES_DIR = path.join(ROOT, "files");
export const KB_DIR = path.join(ROOT, "kb");
export const IMAGES_DIR = path.join(KB_DIR, "images");
export const PAGES_DIR = path.join(KB_DIR, "pages");
export const MANUAL_MD = path.join(KB_DIR, "manual.md");
export const MANIFEST_JSON = path.join(KB_DIR, "manifest.json");

export const PRODUCT = "Vulcan OmniPro 220";

export interface DocConfig {
  /** stable slug used in page ids and filenames */
  slug: string;
  /** filename under files/ */
  pdf: string;
  /** human title shown in manual.md + citations */
  title: string;
  /** reading order (lower first) */
  order: number;
}

/** Source documents, in the order they appear in the stuffed manual. */
export const DOCS: DocConfig[] = [
  { slug: "owner-manual", pdf: "owner-manual.pdf", title: "Owner's Manual", order: 0 },
  { slug: "quick-start-guide", pdf: "quick-start-guide.pdf", title: "Quick Start Guide", order: 1 },
  { slug: "selection-chart", pdf: "selection-chart.pdf", title: "Welder Selection Chart", order: 2 },
];

// --- extraction (stage 2) ---
export const MODEL = "claude-opus-5";
export const EXTRACT_MAX_TOKENS = 16000;
export const DEFAULT_DPI = 150;
export const DEFAULT_CONCURRENCY = 4;

// --- curation (stage 3): which page images get stuffed into the system prompt ---
/** Pages scoring at/above this on visual_importance are curated. */
export const CURATE_THRESHOLD = 8;
/** Hard cap on curated images to bound per-query token cost. */
export const MAX_CURATED = 8;
/** content_type values that make a page inherently visual → always curated. */
export const ALWAYS_CURATE_CONTENT_TYPES = new Set(["schematic"]);
/** tags (or the page's own slug) that force curation regardless of score. */
export const ALWAYS_CURATE_TAGS = new Set([
  "selection-chart",
  "wiring-schematic",
  "schematic",
  "weld-diagnosis",
  "front-panel",
  "wire-feed",
]);

/** One figure/diagram/photo on a page. */
export interface Figure {
  label: string;
  kind: string;
  description: string;
  /** data that exists only in the image, pulled into words */
  data: string;
}

/** The structured result of extracting one page (the `emit_page` tool payload). */
export interface PageExtraction {
  section_title: string;
  summary: string;
  markdown: string;
  content_types: string[];
  figures: Figure[];
  visual_importance: number;
  tags: string[];
}

/** A fully-resolved page record: identity + extraction. Stored in kb/pages/<id>.md. */
export interface PageRecord extends PageExtraction {
  id: string;
  doc: string;
  docTitle: string;
  docOrder: number;
  page: number;
  image: string; // repo-relative path to the PNG
}
