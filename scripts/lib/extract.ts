// Stage 2 — extract one structured record per page with Claude vision.
// The only stage that calls the API and the only non-deterministic one; its
// output (kb/pages/<id>.md) is committed and never regenerated unless --force.
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import {
  DOCS,
  FILES_DIR,
  IMAGES_DIR,
  MODEL,
  EXTRACT_MAX_TOKENS,
  DEFAULT_CONCURRENCY,
  type DocConfig,
  type PageExtraction,
  type PageRecord,
} from "./config.ts";
import { pageCount } from "./render.ts";
import {
  exists,
  log,
  pageFileExists,
  pageId,
  pool,
  rel,
  step,
  warn,
  writePageFile,
} from "./util.ts";

const SYSTEM = `You are a meticulous technical-documentation extractor. You are digitizing one page
at a time of the owner's manual, quick-start guide, and selection chart for the Vulcan OmniPro 220
multiprocess welder. This extraction is the *only* representation of the manual a downstream support
agent will ever see, so it must be complete and faithful — never summarize away detail.

For the single page image provided, call the emit_page tool exactly once with:

- markdown: a faithful, verbatim transcription of the page as GitHub-flavored Markdown.
  * Transcribe ALL body text exactly, preserving headings, numbered/lettered safety lists, and the
    wording of every DANGER/WARNING/CAUTION/NOTICE block (label them as such).
  * Render EVERY table as a real Markdown table — duty-cycle matrices (keep every amperage/voltage/
    percentage cell), specification tables, troubleshooting matrices, and parts lists especially.
  * For every figure, diagram, schematic, chart, or photo, insert a block right where it appears:
    "> **[<label> — <kind>]** <description>. Data: <data that exists only in the image>."
    Extract the information the picture carries into words: which socket/terminal a cable connects
    to and its polarity, what wiring the schematic shows, what each weld-diagnosis photo depicts and
    its cause/fix, the decision logic of a selection chart, callout numbers on an exploded parts
    diagram, control-panel button labels. A reader who cannot see the image must still get the fact.
  * Do not invent content. If text is unreadable, write [illegible]. Ignore pure page furniture
    (page numbers, repeated footer phone numbers) unless it carries meaning.

- section_title: the manual section/heading this page belongs to (e.g. "Duty Cycle",
  "MIG/Flux-Cored Wire Welding", "Parts List and Diagram").
- summary: one sentence on what this page lets a user do or decide.
- content_types: any of prose, table, diagram, schematic, photo, chart, parts-list, warning, toc,
  cover, spec-table, troubleshooting.
- figures: one entry per figure/diagram/schematic/photo with {label, kind, description, data}.
- tags: lowercase topical keywords a user question might map to (e.g. duty-cycle, polarity, tig,
  mig, flux-cored, stick, porosity, wire-feed, front-panel, wiring-schematic, weld-diagnosis,
  selection-chart, specifications, maintenance, troubleshooting).
- visual_importance: 0-10 — how much the page's meaning depends on SEEING the image itself.
  10 = the selection chart, the wiring schematic, or weld-diagnosis photos (data lives in the
  picture); 7-9 = labeled control-panel / wire-feed / polarity diagrams; 3-6 = a page with a helpful
  but non-essential illustration; 0-2 = plain text or tables that transcribe losslessly.`;

const EMIT_TOOL: Anthropic.Tool = {
  name: "emit_page",
  description: "Emit the complete structured extraction for one manual page.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "section_title",
      "summary",
      "markdown",
      "content_types",
      "figures",
      "tags",
      "visual_importance",
    ],
    properties: {
      section_title: { type: "string" },
      summary: { type: "string" },
      markdown: { type: "string" },
      content_types: { type: "array", items: { type: "string" } },
      figures: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "kind", "description", "data"],
          properties: {
            label: { type: "string" },
            kind: { type: "string" },
            description: { type: "string" },
            data: { type: "string" },
          },
        },
      },
      tags: { type: "array", items: { type: "string" } },
      visual_importance: { type: "integer" },
    },
  },
};

function makeClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env (ANTHROPIC_API_KEY=sk-ant-...) — " +
        "only the 'extract' stage needs it.",
    );
  }
  return new Anthropic({ maxRetries: 4 });
}

/** Extract one page image into a full PageRecord (one vision call). */
export async function extractPage(
  client: Anthropic,
  doc: DocConfig,
  page: number,
): Promise<PageRecord> {
  const id = pageId(doc.slug, page);
  const imgPath = path.join(IMAGES_DIR, `${id}.png`);
  if (!exists(imgPath)) throw new Error(`missing render for ${id} — run 'render' first`);
  const data = fs.readFileSync(imgPath).toString("base64");

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: EXTRACT_MAX_TOKENS,
    system: SYSTEM,
    tools: [EMIT_TOOL],
    tool_choice: { type: "auto" },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data } },
          {
            type: "text",
            text: `This is page ${page} of "${doc.title}" (document: ${doc.slug}). Extract it now with emit_page.`,
          },
        ],
      },
    ],
  });

  const toolUse = res.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "emit_page",
  );
  if (!toolUse) {
    const text = res.content.find((b) => b.type === "text");
    throw new Error(
      `model did not call emit_page for ${id} (stop_reason=${res.stop_reason})` +
        (text && "text" in text ? `: ${text.text.slice(0, 200)}` : ""),
    );
  }

  const e = toolUse.input as PageExtraction;
  return {
    id,
    doc: doc.slug,
    docTitle: doc.title,
    docOrder: doc.order,
    page,
    image: rel(imgPath),
    section_title: String(e.section_title ?? ""),
    summary: String(e.summary ?? ""),
    markdown: String(e.markdown ?? ""),
    content_types: (e.content_types ?? []).map(String),
    figures: (e.figures ?? []).map((f) => ({
      label: String(f.label ?? ""),
      kind: String(f.kind ?? ""),
      description: String(f.description ?? ""),
      data: String(f.data ?? ""),
    })),
    tags: (e.tags ?? []).map((t) => String(t).toLowerCase()),
    visual_importance: Math.max(0, Math.min(10, Math.round(Number(e.visual_importance ?? 0)))),
  };
}

export interface ExtractOptions {
  force?: boolean;
  only?: string;
  pages?: [number, number];
  concurrency?: number;
}

/** Extract all pending pages. Skips pages already extracted unless --force. */
export async function extract(opts: ExtractOptions = {}): Promise<void> {
  const docs = opts.only ? DOCS.filter((d) => d.slug === opts.only) : DOCS;
  if (opts.only && docs.length === 0) throw new Error(`unknown --only doc: ${opts.only}`);

  // Build the worklist of (doc, page) pairs still needing extraction.
  const jobs: { doc: DocConfig; page: number; id: string }[] = [];
  for (const doc of docs) {
    const total = pageCount(path.join(FILES_DIR, doc.pdf));
    const [lo, hi] = opts.pages ?? [1, total];
    for (let p = Math.max(1, lo); p <= Math.min(total, hi); p++) {
      const id = pageId(doc.slug, p);
      if (!opts.force && pageFileExists(id)) continue;
      jobs.push({ doc, page: p, id });
    }
  }

  step(`Extract → structured pages (Claude vision, ${MODEL})`);
  if (jobs.length === 0) {
    warn("nothing to extract (all pages already done; use --force to redo)");
    return;
  }

  const client = makeClient();
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  log(`  ${jobs.length} page(s) to extract, concurrency ${concurrency}`);

  let ok = 0;
  const failures: string[] = [];
  await pool(jobs, concurrency, async (job) => {
    try {
      const record = await extractPage(client, job.doc, job.page);
      writePageFile(job.id, record);
      ok++;
      log(`  ✓ ${job.id}  “${record.section_title}”  (vi=${record.visual_importance})`);
    } catch (err) {
      failures.push(job.id);
      warn(`✗ ${job.id}: ${(err as Error).message}`);
    }
  });

  log(`\n  extracted ${ok}/${jobs.length}`);
  if (failures.length) {
    throw new Error(
      `${failures.length} page(s) failed: ${failures.join(", ")}. ` +
        `Re-run 'extract' to retry just those (completed pages are skipped).`,
    );
  }
}
