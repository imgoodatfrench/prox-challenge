# Vulcan OmniPro 220 Agent — How It Works & Why

A multimodal reasoning agent for the Vulcan OmniPro 220 multiprocess welder, built on the
**Claude Agent SDK**. This is the "how I think about it" companion to the setup-focused
[README](./README.md). Full pipeline detail lives in [docs/EXTRACTION.md](./docs/EXTRACTION.md);
the reasoning behind the phases is in [PLAN.md](./PLAN.md).

---

## TL;DR (the whole thing in bullets)

- **One agent, `claude-opus-5`, on the Claude Agent SDK.** One repo (TypeScript + Next.js) holds
  both the SDK backend and the React UI that renders its multimodal output.
- **No retrieval. I stuff the entire manual into the system prompt.** The corpus is tiny — 51 pages
  → ~196K characters (~50K tokens) of Markdown — so the whole thing fits in context with room to
  spare. That's a deliberate choice over RAG (see below).
- **The manual is processed offline into `.md` files, once, and committed to git.** Runtime never
  touches a PDF or pays for a vision call. It just reads `kb/manual.md`.
- **Prompt caching pays for the stuffing.** The stuffed prefix is byte-stable, so after turn 1 it's
  a cache hit — roughly one cheap query instead of re-reading 50K tokens every time.
- **It is genuinely multimodal, not text-with-pictures-bolted-on.** Four tools let the model *look
  at* manual pages, *show* real figures, *draw* custom SVG diagrams, and *build* interactive
  artifacts (calculators, configurators, troubleshooting trees) rendered live in the chat.
- **Only *some* page images are stuffed.** The high-value visual pages (schematics, the selection
  chart, wire-feed/front-panel/polarity figures, anything scored visually critical) ride along in
  the cached prompt; the rest are served on demand via a tool. Stuffing all 51 images would blow up
  per-query cost for little gain.
- **Answers stream token-by-token over SSE**, with images / diagrams / artifacts interleaved in the
  exact order the model produced them. Multi-turn is handled by SDK sessions.

---

## How the agent works

### 1. Everything the model knows is in one cached system prompt

`lib/agent.ts` builds the system prompt as **persona + the full stuffed manual**. The persona sets
the job (a friendly expert for someone setting this welder up in their garage), the ground rules
(answer only from the manual, cite pages, ask *one* clarifying question when ambiguous, lead with
safety), and the multimodal playbook (when to show vs. draw vs. build).

Then the entire `kb/manual.md` is appended. Because both halves are deterministic, the whole prompt
is a **byte-stable prefix** that prompt caching hits on every turn after the first.

The agent is deliberately hermetic: `tools: []`, `settingSources: []`, and only the four
multimodal tools are allow-listed. No filesystem, no bash, no `~/.claude` config leaking in — the
model's world is exactly the manual plus its four ways of drawing.

### 2. The query loop

`app/api/chat/route.ts` runs one `query()` per turn and adapts the SDK's async message iterator to
a **Server-Sent Events** stream:

- text deltas → streamed to the browser as they're generated;
- tool calls → each tool `emit`s a structured "part" (a manual image, a diagram, an artifact) that's
  pushed onto the same stream, so visuals land inline in produced-order;
- the terminal `result` carries usage stats — including `cache_read_input_tokens`, which is how I
  verify the stuffing is actually being cached.

Sessions (`resume`) carry context across turns for follow-ups.

---

## The big design choice: context stuffing over RAG

**The corpus is small, so I skipped retrieval entirely.**

- 51 pages across three PDFs (48-page owner's manual + 2-page quick start + 1-page selection chart)
  becomes ~196K characters / ~50K tokens after extraction — a rounding error against a 1M-token
  window.
- Stuffing gives **perfect recall**: there is no retrieval step to miss the right chunk, no
  embedding index to build, no vocabulary-mismatch failure mode where the user says "the pinch
  roller" and the manual says "idler arm." The model sees the whole document, always.
- The one real cost — re-reading 50K tokens every turn — is neutralized by **prompt caching**. The
  first turn primes the cache (~$0.75 order-of-magnitude); every turn after is a cache read at a
  fraction of that.
- This is faster to build, easier to reason about, and has fewer moving parts than a retrieval
  stack — which matters when accuracy on cross-referenced technical questions is the thing being
  graded.

**Retrieval is documented as the scale path, not built.** Past the context window (Prox's full
product catalog), the extraction pipeline stays identical — I'd just index `kb/pages/*.md` behind a
`search_manual` tool instead of stuffing `manual.md`. The offline bundle is already the right
substrate for that swap.

---

## Why "process offline into .md first" instead of stuffing PDFs

Stuffing the raw PDFs would have been the naive version of the same idea, and it fails three ways —
which is exactly why the offline pipeline exists:

1. **The critical data is visual.** Duty-cycle matrices, the wiring schematic, the weld-diagnosis
   photos, the polarity diagrams, the entire selection chart — these live in *images*. A plain text
   dump loses them.
2. **PDFs aren't byte-stable.** Re-serialized on the fly, they'd bust the prompt cache (a ~12× cost
   swing per query).
3. **Vision extraction is expensive** and should run **once**, not on every request.

So a one-time offline pipeline (`npm run ingest`) turns the PDFs into a deterministic, cache-friendly
Markdown bundle that gets committed to git:

- **① Render** — ghostscript rasterizes each page to a 150 DPI PNG (local, no API key,
  byte-identical run to run).
- **② Extract** — one Claude vision call per page (`claude-opus-5`) returns a structured record via a
  single `emit_page` tool: **verbatim body text, every table as Markdown, and a written description of
  every figure — including the data that exists *only* in the image** (which socket a cable enters,
  what each weld-diagnosis photo shows, the selection chart's decision logic). Plus metadata:
  `section_title`, `summary`, `content_types`, `figures[]`, `tags`, and a **`visual_importance` 0–10**
  score. This is the paid stage; its output is committed so it never runs again.
- **③ Bundle** — pure deterministic concatenation into `kb/manual.md` (with a stable TOC, no
  timestamps/paths, sorted order, trailing newline → cache-safe) plus `kb/manifest.json` (page index,
  curation flags, and a `sha256` of `manual.md` for cache-prefix verification).

A determinism test builds the bundle twice and diffs it — if `manual.md` isn't byte-identical, the
cache would silently miss, so this is enforced, not assumed.

---

## Multimodal: not text-only — and only *some* images are stuffed

This is the graded centerpiece. Four tools (`lib/tools.ts`), exposed to the model as an in-process
MCP server:

| Tool | Who sees it | For |
|---|---|---|
| `get_page_image` | **the model** | Load a page PNG so Claude can study a figure/table/schematic closely before answering. Not shown to the user. |
| `show_manual_image` | **the user** | Surface a real manual figure inline with a caption + page citation (wire-feed mechanism, front panel, weld-diagnosis photos, wiring schematic, selection chart). |
| `render_diagram` | the user | Draw a custom labeled **SVG** — polarity / which-cable-in-which-socket, gas & cable routing, torch anatomy — sanitized (no scripts/animations). |
| `render_artifact` | the user | Generate an **interactive** React/HTML app — duty-cycle calculator, settings configurator (process + material + thickness → wire speed & voltage), troubleshooting decision tree — with the real manual numbers baked in. |

The system prompt pushes the model *toward* these: visual / "which socket" questions → show or
draw; "calculate / help me decide / configure" questions → build an artifact; always with a short
cited text answer around the visual.

### Only some images are stuffed (curation)

Here's the nuance behind the "multimodal but efficient" claim. **The text of all 51 pages is always
stuffed. The page *images* are not.** Stuffing every page image into the cached prompt would balloon
per-query token cost for pages that are mostly prose.

So the bundle **curates** which images ride along in the system prompt (`scripts/lib/bundle.ts`):

- A page is curated if it's **inherently visual** — its `content_types` include a schematic, or its
  tags/slug mark it as the selection chart, wiring schematic, weld-diagnosis, front-panel, or
  wire-feed figure — **or** its `visual_importance ≥ 8`.
- Everything else is **served on demand**: every page is still rendered to a PNG, and the model can
  pull any of them with `get_page_image` when a question actually needs that figure.

In the current build that curated set is **33 of 51 pages** — the visually-dense heart of the manual
(setup diagrams, polarity, wire feed, the LCD screens, the selection chart) — while the mostly-text
safety and parts-list pages stay text-only in the prompt and are fetched as images only if a
question reaches for them. The model gets the visuals that matter up front and can reach for the rest
without them being permanently resident in every request.

### Rendering the multimodal output safely

Generated artifacts run in a **sandboxed `<iframe srcdoc>`** (`lib/artifact-template.ts`,
`components/ArtifactFrame.tsx`) — `sandbox="allow-scripts"` only (opaque origin, no access to parent
DOM/cookies), a strict CSP with `connect-src 'none'` so an artifact can't exfiltrate anything, and a
`postMessage` bridge for auto-height and error reporting. React artifacts are transformed in-browser
with Babel-standalone. This is the reverse-engineered-Claude-artifacts approach the challenge points
at, with the security model made explicit.

---

## Tone & helpfulness

The persona targets the actual user: someone standing in their garage with a machine they just
bought, capable but not a pro welder. So the agent explains jargon on first use, leads with the
direct answer then the detail, gives procedures as ordered steps, pulls exact numbers from the
duty-cycle/spec tables (never rounds silently), surfaces the relevant safety warning when a step
involves shock/fumes/gas/heat, and asks **one** focused clarifying question when voltage or process
is unstated and would change the answer.

---

## Quality gate

`eval/` holds 18 golden Q&A cases (`cases.jsonl`) driven through an LLM judge (`judge.ts`) that
checks **both** correctness and modality — e.g. a polarity question should *draw*, a duty-cycle
cross-voltage question should get the exact number, an ambiguous question should trigger a
clarification, and a not-in-manual question should be refused rather than hallucinated.

The key idea: **no hand-written golden answers.** The extracted `kb/manual.md` is itself the ground
truth, so the judge grades each answer against the manual — catching hallucinations without anyone
re-reading 48 pages. Grading runs in four layers: modality and pinned-value ("anchor") checks are
deterministic and read nothing; behavior (clarify / refuse) and factual grounding go through the
judge. Auth follows Claude Code's own rule — with `ANTHROPIC_API_KEY` set both agent and judge bill
the API; with it blank they run on a Claude Code subscription login, so a full local eval costs
nothing. Run with `npm run eval` (needs `npm run dev` up); `EVAL_VERBOSE=1` dumps each raw answer.

This gate earns its keep: an early run flagged three real gaps — an ungrounded real-world aside, a
duty-cycle question answered on assumed process/voltage instead of clarifying, and a fabricated
answer to an out-of-scope (air-compressor) question. All three were fixed in the agent's ground
rules in `lib/agent.ts`, not by loosening the test.

---

## Running it

`kb/` is committed, so reviewers **do not** run the ingest pipeline — that's the one-time offline
step I already ran. From clone to running agent:

```bash
cp .env.example .env    # add your ANTHROPIC_API_KEY
npm install
npm run dev             # http://localhost:3000
```

The agent is a long-running Node service (the Agent SDK spawns the Claude Code runtime as a
subprocess, so it's **not** edge/serverless — `railway.json` is set up for that). Voice input is
wired via the browser Speech Recognition API (`components/useSpeechRecognition.ts`).
