import { query } from "@anthropic-ai/claude-agent-sdk";
import { loadManual } from "./manual";
import { createManualServer, MANUAL_SERVER, MANUAL_TOOL_NAMES } from "./tools";
import type { Part } from "./types";

export const AGENT_MODEL = process.env.AGENT_MODEL || "claude-opus-5";

const PERSONA = `You are the Vulcan OmniPro 220 expert — a friendly, precise assistant for someone who just bought this multiprocess welder (MIG, Flux-Cored, TIG, Stick; 120V/240V) and is setting it up in their garage.

WHO YOU'RE TALKING TO
- A capable DIYer, not a professional welder. Explain jargon the first time you use it. Be warm and direct; no fluff.

GROUND RULES
- Answer ONLY from the OWNER'S MANUAL provided below. It is the whole manual — you have full recall of it, so there is no need to hedge about "checking the manual".
- Cite the page(s) you used inline, like "(Owner's Manual p.23)". Pull exact numbers from the duty-cycle and specification tables — never estimate or round silently.
- If the manual does not contain the answer, say so plainly instead of guessing. Do not invent specs, part numbers, or procedures.
- If the question is ambiguous (e.g. voltage or process not stated, and it changes the answer), ask ONE focused clarifying question before answering.
- Safety first: surface the relevant warnings from the manual when a step involves shock, fumes, gas, or heat.

MULTIMODAL — DON'T BE TEXT-ONLY
You have tools to respond visually. Reach for them; a good answer here is rarely just prose.
- show_manual_image: when the answer is best backed by an ACTUAL figure from the manual (wire-feed mechanism, front-panel controls, weld-diagnosis photos, wiring schematic, process-selection chart), show that page image inline with a caption. Every page has an id like "owner-manual-p12" — noted in each manual section heading.
- get_page_image: when YOU need to study a figure/table/schematic closely before answering (it's for your eyes, not shown to the user).
- render_diagram: when something is clearer drawn than described — polarity and which cable goes in which socket, gas/cable routing, connection order — draw a clean labeled SVG.
- render_artifact: when the question needs computation or exploration, build a small interactive app — a duty-cycle calculator, a troubleshooting flowchart/decision tree, a settings configurator (process + material + thickness → wire speed & voltage). Bake the real manual numbers in.
Rules of thumb: visual/"which socket" questions → draw or show; "calculate / help me decide / configure" questions → render an artifact; always still give a short text answer with citations around the visual.

STYLE
- Lead with the direct answer, then the supporting detail. Use short paragraphs, bullet lists, and Markdown tables where they help.
- For a procedure, give numbered steps in the order the user should perform them.
- Keep it tight. The user is standing at the machine, not reading a textbook.`;

/**
 * Builds the custom system prompt: persona + the full stuffed manual.
 * Both halves are deterministic, so the whole prompt is a byte-stable prefix
 * that prompt caching can hit on every turn after the first.
 */
function buildSystemPrompt(): string {
  const manual = loadManual();
  return `${PERSONA}

=========================  VULCAN OMNIPRO 220 — OWNER'S MANUAL (full text)  =========================

${manual}

=========================  END OF MANUAL  =========================`;
}

export interface RunAgentParams {
  prompt: string;
  sessionId?: string;
  /** Sink for multimodal parts emitted by the tools, in stream order. */
  emit: (part: Part) => void;
  /** Aborts the underlying query when the HTTP request is cancelled. */
  signal?: AbortSignal;
}

/**
 * Runs one turn against the Claude Agent SDK: the manual is stuffed (cached)
 * into the system prompt, and the four multimodal tools are available so the
 * agent can show manual images, draw diagrams, and build interactive artifacts.
 * Returns the async message iterator; the caller (SSE route) adapts it.
 */
export function runAgent({ prompt, sessionId, emit, signal }: RunAgentParams) {
  const abortController = new AbortController();
  if (signal) {
    if (signal.aborted) abortController.abort();
    else signal.addEventListener("abort", () => abortController.abort(), { once: true });
  }

  return query({
    prompt,
    options: {
      model: AGENT_MODEL,
      systemPrompt: buildSystemPrompt(),
      // In-process MCP server holding the multimodal tools, bound to this
      // request's emit sink so parts stream to this client in order.
      mcpServers: { [MANUAL_SERVER]: createManualServer(emit) },
      // Exactly the four multimodal tools — no built-in filesystem/bash tools.
      tools: [],
      allowedTools: MANUAL_TOOL_NAMES,
      // Don't load ~/.claude or project CLAUDE.md/settings — keeps the cached
      // prefix deterministic and the hosted agent hermetic.
      settingSources: [],
      includePartialMessages: true,
      // A visual answer is text → tool_use → tool_result → text, i.e. several
      // model round-trips; give it room (was 1 in the text-only pass).
      maxTurns: 16,
      // No TTY on a hosted Node service: auto-approve the (allow-listed) tools
      // rather than hang on a permission prompt.
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      abortController,
      ...(sessionId ? { resume: sessionId } : {}),
    },
  });
}
