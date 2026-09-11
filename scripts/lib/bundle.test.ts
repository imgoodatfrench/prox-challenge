// Determinism + curation checks for the bundle stage. No API key required.
//   node --experimental-strip-types scripts/lib/bundle.test.ts
import assert from "node:assert/strict";
import { buildManual, buildManifest, computeCurated } from "./bundle.ts";
import { serializePageFile, parsePageFile, stableStringify, sha256 } from "./util.ts";
import type { PageRecord } from "./config.ts";

function page(over: Partial<PageRecord> & { id: string; doc: string; docOrder: number; page: number }): PageRecord {
  return {
    docTitle: over.doc,
    section_title: "Section",
    summary: "A page.",
    markdown: "# Heading\n\nBody text.\n\n| a | b |\n| - | - |\n| 1 | 2 |",
    content_types: ["prose", "table"],
    figures: [],
    tags: [],
    visual_importance: 2,
    image: `kb/images/${over.id}.png`,
    ...over,
  };
}

// A representative spread: plain text, a duty-cycle table, the schematic, the selection chart.
const pages: PageRecord[] = [
  page({ id: "owner-manual-p07", doc: "owner-manual", docOrder: 0, page: 7, section_title: "Specifications", visual_importance: 1 }),
  page({ id: "owner-manual-p08", doc: "owner-manual", docOrder: 0, page: 8, section_title: "Controls", tags: ["front-panel"], visual_importance: 8 }),
  page({ id: "owner-manual-p46", doc: "owner-manual", docOrder: 0, page: 46, section_title: "Parts List", content_types: ["schematic"], tags: ["wiring-schematic"], visual_importance: 9 }),
  page({ id: "quick-start-guide-p01", doc: "quick-start-guide", docOrder: 1, page: 1, section_title: "Setup", visual_importance: 4 }),
  page({ id: "selection-chart-p01", doc: "selection-chart", docOrder: 2, page: 1, section_title: "How to choose", tags: ["selection-chart"], visual_importance: 10 }),
];

let n = 0;
const check = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
};

console.log("bundle determinism + curation");

check("buildManual is byte-identical across runs", () => {
  assert.equal(buildManual(pages), buildManual([...pages].reverse()));
});

check("manifest is byte-identical across runs", () => {
  const a = stableStringify(buildManifest(pages, buildManual(pages)));
  const b = stableStringify(buildManifest([...pages].reverse(), buildManual([...pages].reverse())));
  assert.equal(a, b);
});

check("manual.md renders pages in reading order with anchors + TOC", () => {
  const md = buildManual(pages);
  assert.match(md, /## Contents/);
  assert.ok(md.indexOf("{#owner-manual-p07}") < md.indexOf("{#selection-chart-p01}"));
  for (const p of pages) assert.match(md, new RegExp(`\\{#${p.id}\\}`));
});

check("manifest sha256 matches the emitted manual.md", () => {
  const md = buildManual(pages);
  const m = buildManifest(pages, md) as { manualSha256: string };
  assert.equal(m.manualSha256, sha256(md));
});

check("curation always includes the selection chart + schematic", () => {
  const c = computeCurated(pages);
  assert.ok(c.has("selection-chart-p01"));
  assert.ok(c.has("owner-manual-p46"));
});

check("curation excludes plain low-importance text pages", () => {
  const c = computeCurated(pages);
  assert.ok(!c.has("owner-manual-p07"));
});

check("curation respects MAX_CURATED cap while keeping always-include pages", () => {
  // 40 high-importance candidates + the always-include schematic/chart.
  const many: PageRecord[] = [];
  for (let i = 1; i <= 40; i++) {
    many.push(page({ id: `owner-manual-p${String(i).padStart(2, "0")}`, doc: "owner-manual", docOrder: 0, page: i, visual_importance: 9 }));
  }
  many.push(page({ id: "selection-chart-p01", doc: "selection-chart", docOrder: 2, page: 1, tags: ["selection-chart"], visual_importance: 10 }));
  const c = computeCurated(many);
  assert.ok(c.size <= 8, `expected <= 8 curated, got ${c.size}`);
  assert.ok(c.has("selection-chart-p01"), "always-include page must survive the cap");
});

check("page file round-trips (serialize → parse) losslessly", () => {
  const rec = pages[2];
  const parsed = parsePageFile(serializePageFile(rec));
  assert.deepEqual(parsed, { ...rec, markdown: rec.markdown.trim() });
});

console.log(`\n${n} checks passed`);
