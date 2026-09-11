# Extraction Pipeline — the Offline Bundle

> Detailed design + runbook for **Phase 2** of [PLAN.md](../PLAN.md): turning the three
> source PDFs into a deterministic, cached-friendly knowledge bundle the agent stuffs into
> its system prompt.

## Why an offline bundle at all

The corpus is tiny — **51 pages** across three PDFs:

| Document | File | Pages |
|---|---|---|
| Owner's Manual & Safety Instructions | `files/owner-manual.pdf` | 48 |
| Quick Start Guide | `files/quick-start-guide.pdf` | 2 |
| Welder Selection Chart ("How to choose a welder") | `files/selection-chart.pdf` | 1 |

At this size we **stuff the whole manual into context (cached)** rather than build retrieval
(see PLAN.md rationale). But raw PDFs are a bad thing to stuff:

1. **The critical data is visual.** Duty-cycle matrices, the wiring schematic, the weld-diagnosis
   photos, and the entire selection chart are *images*. A text dump loses them.
2. **We need byte-stable input for the prompt cache.** Any byte change in the cached prefix busts
   the cache (a ~12× cost swing per query). PDFs re-serialized on the fly are not stable.
3. **We want to run the expensive vision pass exactly once**, commit the result, and never pay for
   it again.

So the bundle is produced **once, offline, and committed to git**. The runtime never touches a PDF
or a vision-extraction call — it reads `kb/manual.md` + `kb/manifest.json` + `kb/images/*.png`.

## The three stages

The pipeline is split into three independent, individually re-runnable stages. This separation is
the whole design — it makes the expensive stage resumable and the cache-critical stage deterministic.

```
files/*.pdf
   │
   ▼  ① render    (ghostscript, local, no API key, deterministic)
kb/images/<id>.png          one PNG per page @150 DPI
   │
   ▼  ② extract   (Claude vision, one call per page, resumable, the only paid stage)
kb/pages/<id>.md            verbatim text + markdown tables + figure descriptions + JSON metadata
   │
   ▼  ③ bundle    (pure concatenation, local, no API key, deterministic)
kb/manual.md                the stuffed document (stable bytes → cache-safe)
kb/manifest.json            page metadata + which images are "curated" for the system prompt
```

`id` is `<doc-slug>-p<NN>` (zero-padded), e.g. `owner-manual-p07`, `selection-chart-p01`. It sorts
lexically into reading order and is the stable key across all three stages and the runtime.

### ① Render — PDF → per-page PNG

- **Tool:** ghostscript (`gs`, already on the machine). Poppler is not installed; `gs` renders
  cleanly and, verified, produces **byte-identical PNGs across runs** — re-rendering never creates
  spurious diffs.
- **Resolution:** 150 DPI. An A4/Letter page at 150 DPI (~1240×1754) sits right at Claude vision's
  1568px long-edge downscale cap, so 150 DPI is the sweet spot: maximum detail the model will
  actually use, minimum committed file size (~60–630 KB/page, ~16 MB total).
- One `gs` invocation per page (`-dFirstPage=n -dLastPage=n`) so `--pages` / `--force` / `--only`
  all work uniformly and filenames are exact.
- Output doubles as the runtime asset store: `get_page_image` serves any `kb/images/<id>.png`
  directly, so every page is rendered, not just the curated ones.

### ② Extract — PNG → structured page markdown (the paid stage)

One `messages.create` call per page against **`claude-opus-5`** (adaptive thinking) with the page
PNG as an image block. The model returns a **single structured record** via a one-tool
"function call" (`emit_page`) — using a tool rather than free-form JSON means the SDK parses the
result into an object, so the `markdown` field can safely contain markdown tables, back-ticks and
figure blocks without any brittle string-parsing on our side. `tool_choice` is left `auto` with only
that one tool provided (dodges the thinking/forced-tool-choice incompatibility while still reliably
producing the call).

The extraction prompt demands, per page:

- **Verbatim transcription** of all body text (headings, numbered safety lists, warnings preserved).
- **Every table as a GitHub-flavored markdown table** — duty-cycle matrices, spec tables,
  troubleshooting matrices, parts lists.
- **A description of every figure/diagram/schematic/photo**, and crucially the **data that exists
  only in the image** extracted into words (e.g. the selection chart's decision logic, which socket
  a cable enters in a polarity diagram, what each weld-diagnosis photo shows). This is the answer to
  "some critical information exists only in images."
- Metadata for the bundle/runtime: `section_title`, one-line `summary`, `content_types`, a
  `figures[]` list, topical `tags`, and a **`visual_importance` 0–10** score (how much the page's
  meaning depends on *seeing* the image) used to decide curation.

Each page is written to `kb/pages/<id>.md` as a human-readable markdown body preceded by a
`<!--prox:meta … prox:meta-->` JSON header. This file is the **committed source of truth**; the
vision call (the only non-deterministic step) never runs again once its output is committed.

**Resumability:** a page whose `.md` already exists is skipped unless `--force`, and calls run
through a small concurrency pool (default 4). A mid-run failure (rate limit, network) loses only the
in-flight page — everything already written stays. Cost is roughly **$1–3 total, one time**
(~51 calls, image + a few thousand output tokens each).

### ③ Bundle — pages → stuffed doc + manifest

Pure, local, deterministic assembly (no API):

- **`kb/manual.md`** — pages concatenated in `(document order, page number)` order, each under a
  stable `## <Doc> — Page N {#id}` heading, preceded by an auto-generated table of contents built
  from the section titles. **No timestamps, no absolute paths, sorted deterministically, trailing
  newline** → byte-stable, so the runtime's cached system-prompt prefix stays valid across restarts.
- **`kb/manifest.json`** — the runtime index: per-page `{id, doc, page, image, sectionTitle,
  summary, contentTypes, figures, tags, visualImportance, curated}`, plus `documents[]`,
  `pageCount`, the list of curated image ids, and a `sha256` of `manual.md` for cache-prefix
  verification. Serialized with **sorted keys** and stable formatting so it too is deterministic.

**Curation (which images get stuffed into the system prompt).** Stuffing *all* 51 page images would
blow up per-query cost, so we stuff only high-value ones and serve the rest on demand via
`get_page_image`. A page is curated if it is inherently visual — `content_types` includes a schematic,
or tags/slug mark it as the selection chart, wiring schematic, weld-diagnosis, front-panel, or
wire-feed figure — **or** its `visual_importance ≥ 8`. The set is then capped (default 8) by
importance, with the always-include set never dropped. The result is flagged `curated: true` in the
manifest; Phase 3's runtime reads that flag to decide which images to attach to the (cached) system
prompt.

## Determinism contract (why this survives the prompt cache)

The cache prefix is `persona + manual.md + curated images`. To keep it byte-stable:

- The **vision pass runs once**; its output is committed. Re-running `bundle` from the committed
  `kb/pages/*.md` reproduces `manual.md` **byte-for-byte** (verified by a determinism test that
  builds twice and diffs).
- No stage writes a timestamp, hostname, absolute path, or unsorted map into a committed artifact.
- Ghostscript renders are byte-identical run to run, so images are stable too.

If `usage.cache_read_input_tokens` is ever 0 on turn 2 at runtime, the bundle changed — regenerate
and re-commit.

## CLI / runbook

```bash
# one-time, needs an Anthropic key in .env (ANTHROPIC_API_KEY=...)
npm run ingest            # = render → extract → bundle for everything

# or drive stages individually
npm run ingest -- render                 # (re)render all page PNGs — no key needed
npm run ingest -- extract                # vision pass; skips pages already done
npm run ingest -- bundle                 # rebuild manual.md + manifest.json — no key needed
npm run ingest -- status                 # what's rendered / extracted / bundled

# useful flags
npm run ingest -- extract --only owner-manual --pages 7-9   # scope a doc / page range
npm run ingest -- render --force                            # ignore existing output
npm run ingest -- extract --concurrency 6 --dpi 150
```

Stages 1 and 3 need no API key; only `extract` does. Missing key → a clear error, not a stack trace.
`.env` is loaded by the script itself (no `dotenv` dependency).

## Output layout (committed)

```
kb/
  images/     <id>.png   — every page, 150 DPI (runtime get_page_image + curated stuffing)
  pages/      <id>.md    — per-page verbatim extraction + JSON metadata (source of truth)
  manual.md              — the stuffed document (cache-stable)
  manifest.json          — page index + curation flags + manual.md sha256
```

## Scale path (documented, not built)

Everything above is retrieval-agnostic. Past the context window, keep stages ① and ② unchanged and
swap only the consumer: index `kb/pages/*.md` (BM25 / a local vector index) behind a `search_manual`
tool instead of stuffing `manual.md`. The extraction bundle is already the right substrate for that.
