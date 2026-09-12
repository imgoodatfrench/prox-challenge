# Vulcan OmniPro 220 Agent — How It Works & Why

A multimodal reasoning agent for the Vulcan OmniPro 220 welder, built on the **Claude Agent SDK**.

## TL;DR

- **Context stuffed the entire manual text into the system prompt.** 51 pages → ~196K chars (~50K tokens), a rounding error against the context window. Deliberate choice over RAG.
  - **Processed offline into `.md`, once, and committed.** Runtime never touches a PDF or a vision call; it reads `kb/manual.md`.
  - **Prompt caching pays for it.** The stuffed prefix is byte-stable, so every turn after the first is a cache hit.
- **Genuinely multimodal**, four tools rendered live in chat:
  - `get_page_image`: pull a page in for the model to study (not shown to the user).
  - `show_manual_image`: surface a real manual figure inline, with a page citation.
  - `render_diagram`: draw a labeled SVG (polarity, cable routing).
  - `render_artifact`: build an interactive React/HTML app (calculators, configurators, troubleshooting trees).
- **Streams over SSE** with images/diagrams/artifacts interleaved in produced-order; multi-turn via SDK sessions.
- **One agent, `claude-opus-5`, Claude Agent SDK.** One TypeScript + Next.js repo for both the SDK backend and the React UI.

## The system prompt

`lib/agent.ts` builds it as **persona + full manual**. The persona (`PERSONA` constant), verbatim:

```text
You are the Vulcan OmniPro 220 expert — a friendly, precise assistant for someone who just bought
this multiprocess welder (MIG, Flux-Cored, TIG, Stick; 120V/240V) and is setting it up in their garage.

WHO YOU'RE TALKING TO
- A capable DIYer, not a professional welder. Explain jargon the first time you use it. Be warm and
  direct; no fluff.

GROUND RULES
- Answer ONLY from the OWNER'S MANUAL provided below. It is the whole manual — you have full recall
  of it, so there is no need to hedge about "checking the manual".
- Cite the page(s) you used inline, like "(Owner's Manual p.23)". Pull exact numbers from the
  duty-cycle and specification tables — never estimate or round silently.
- If the manual does not contain the answer, say so plainly instead of guessing. Do not invent
  specs, part numbers, or procedures.
- If the question is ambiguous (e.g. voltage or process not stated, and it changes the answer), ask
  ONE focused clarifying question before answering.
- Safety first: surface the relevant warnings from the manual when a step involves shock, fumes,
  gas, or heat.

MULTIMODAL — DON'T BE TEXT-ONLY
You have tools to respond visually. Reach for them; a good answer here is rarely just prose.
- show_manual_image: when the answer is best backed by an ACTUAL figure from the manual (wire-feed
  mechanism, front-panel controls, weld-diagnosis photos, wiring schematic, process-selection chart),
  show that page image inline with a caption. Every page has an id like "owner-manual-p12".
- get_page_image: when YOU need to study a figure/table/schematic closely before answering (it's for
  your eyes, not shown to the user).
- render_diagram: when something is clearer drawn than described — polarity and which cable goes in
  which socket, gas/cable routing, connection order — draw a clean labeled SVG.
- render_artifact: when the question needs computation or exploration, build a small interactive app
  — a duty-cycle calculator, a troubleshooting flowchart/decision tree, a settings configurator
  (process + material + thickness → wire speed & voltage). Bake the real manual numbers in.
Rules of thumb: visual/"which socket" questions → draw or show; "calculate / help me decide /
configure" questions → render an artifact; always still give a short text answer with citations
around the visual.

STYLE
- Lead with the direct answer, then the supporting detail. Use short paragraphs, bullet lists, and
  Markdown tables where they help.
- For a procedure, give numbered steps in the order the user should perform them.
- Keep it tight. The user is standing at the machine, not reading a textbook.
```

The entire `kb/manual.md` is appended after it. Both halves are deterministic, so the prompt is a
byte-stable prefix the cache hits after turn 1. `lib/manual.ts` reads and memoizes it so identical
bytes go into every request. The agent is hermetic — `tools: []`, `settingSources: []`, only the
four multimodal tools allow-listed.

## Context stuffing over RAG

At 51 pages, retrieval is more risk than benefit:
- **Perfect recall** — no chunk to miss, no index to build, no "user says *pinch roller*, manual says *idler arm*" mismatch.
- The one cost (re-reading ~50K tokens/turn) is neutralized by **prompt caching**.
- Fewer moving parts, which matters when accuracy on cross-referenced questions is what's graded.

Retrieval is the documented **scale path**, not built: past the context window, index `kb/pages/*.md` behind a `search_manual` tool — the extraction pipeline is unchanged.

## Offline `.md` pipeline (`npm run ingest`, run once, committed)

Stuffing raw PDFs fails three ways: critical data is visual (a text dump loses it), PDFs aren't byte-stable (busts the cache), and vision extraction is expensive (should run once). So:

- **① Render** — ghostscript → one 150 DPI PNG per page (local, byte-identical run to run).
- **② Extract** — one Claude vision call per page (`claude-opus-5`) returns a structured record: verbatim text, tables as Markdown, **a written description of every figure including image-only data** (which socket a cable enters, what each weld-diagnosis photo shows), plus metadata: `content_types`, `tags`, `figures[]`, and a **`visual_importance` 0–10** score. The paid stage; output committed so it never reruns.
- **③ Bundle** — deterministic concatenation → `kb/manual.md` (stable TOC, no timestamps/paths, sorted → cache-safe) + `kb/manifest.json` (index, curation flags, `sha256`). A test builds twice and diffs to enforce byte-identity.

## Multimodal + image curation

Four tools (`lib/tools.ts`), an in-process MCP server:

| Tool | Seen by | For |
|---|---|---|
| `get_page_image` | model | Study a page closely before answering. Not shown to the user. |
| `show_manual_image` | user | Surface a real manual figure inline with caption + page citation. |
| `render_diagram` | user | Draw a labeled **SVG** — polarity, cable routing, torch anatomy (sanitized). |
| `render_artifact` | user | Generate an **interactive** React/HTML app with the real manual numbers baked in. |

**Which images are stuffed:** all page *text* is always in the prompt; page *images* are curated (`scripts/lib/bundle.ts`). A page is stuffed if it's inherently visual (`content_types` includes a schematic, or its tags/slug mark it selection-chart / wiring-schematic / weld-diagnosis / front-panel / wire-feed) **or** its `visual_importance ≥ 8`. That's **33 of 51** — the visually dense heart of the manual.

The rest are **served on demand — not rendered on demand**: all 51 PNGs are rasterized offline and committed to `kb/images/`. `get_page_image` reads an existing file; "on demand" just means non-curated images aren't resident in the prompt but can be pulled into the model's view when a question needs one.

**Rendering safety:** artifacts run in a sandboxed `<iframe srcdoc>` (`lib/artifact-template.ts`) — `sandbox="allow-scripts"` only, strict CSP with `connect-src 'none'` (no exfiltration), `postMessage` bridge for auto-height and errors. React is transformed in-browser via Babel-standalone.

## Tone & quality gate

Persona targets a capable-but-not-pro DIYer: explain jargon, lead with the answer, numbered steps, exact table numbers, safety warnings, one clarifying question when ambiguous.

`eval/` runs 18 golden cases (`cases.jsonl`) through an LLM judge — **no hand-written answers**: the judge grades against `kb/manual.md` itself. Modality and pinned-value checks are deterministic; behavior (clarify/refuse) and grounding go through the judge. An early run caught three real gaps (an ungrounded aside, a duty-cycle answer that assumed instead of clarifying, a fabricated out-of-scope answer), all fixed in `lib/agent.ts`. Run: `npm run eval`.

## Running it

Hosted: https://prox-challenge-production-654c.up.railway.app/

`kb/` is committed, so reviewers **skip ingest**:

```bash
cp .env.example .env    # add your ANTHROPIC_API_KEY
npm install
npm run dev             # http://localhost:3000
```

Long-running Node service (the SDK spawns the Claude Code runtime as a subprocess — not edge/serverless; `railway.json` is set up). Voice input via the browser Speech Recognition API.
