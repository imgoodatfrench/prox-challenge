// LLM-as-judge, grounded in the extracted manual (kb/manual.md).
//
// The whole point of the eval: we never hand-write "golden" answers and never
// eyeball responses. The manual we already extracted IS the ground truth, so a
// judge model reads the agent's answer against it and grades support/refusal/
// clarification.
//
// Two transports, chosen by auth (see AUTH.md / eval/README):
//   • API-key mode (ANTHROPIC_API_KEY set) — the raw Messages API SDK. The
//     45K-token manual is sent as a *cached* system block, so across ~18 cases
//     it's billed once, not 18×. This is the production/submission path.
//   • Subscription mode (no ANTHROPIC_API_KEY) — the Claude Agent SDK's query(),
//     which runs on your logged-in Claude Code credentials. Lets a full local
//     eval run entirely on your subscription with zero API spend.
// The switch is the same one Claude Code itself uses: presence of the API key.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL || "claude-sonnet-5";

/** No API key => use the Agent SDK (subscription). Key present => raw SDK (API). */
export const JUDGE_ON_SUBSCRIPTION = !process.env.ANTHROPIC_API_KEY;

const MANUAL = readFileSync(join(process.cwd(), "kb", "manual.md"), "utf8");
const MANUAL_TEXT = `===== VULCAN OMNIPRO 220 OWNER'S MANUAL (ground truth) =====\n${MANUAL}`;

/** Pull the first {...} JSON object out of a model reply, tolerating prose/fences. */
function parseJson(raw: string): any {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`no JSON in judge reply: ${raw.slice(0, 200)}`);
  return JSON.parse(raw.slice(start, end + 1));
}

// --- transport A: raw Messages API SDK (API key), manual cached ---------------
let anthropic: any = null;
async function askViaApi(instructions: string, user: string): Promise<any> {
  if (!anthropic) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    anthropic = new Anthropic();
  }
  const res = await anthropic.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 700,
    system: [
      { type: "text", text: instructions },
      { type: "text", text: MANUAL_TEXT, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: user }],
  });
  const text = res.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");
  return parseJson(text);
}

// --- transport B: Claude Agent SDK query() (subscription) ---------------------
async function askViaAgentSdk(instructions: string, user: string): Promise<any> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const q = query({
    prompt: user,
    options: {
      model: JUDGE_MODEL,
      // The Agent SDK auto-caches the (stable) system prompt, so the manual
      // prefix still gets cached across the run.
      systemPrompt: `${instructions}\n\n${MANUAL_TEXT}`,
      tools: [],
      allowedTools: [],
      settingSources: [], // stay hermetic: don't load ~/.claude or project config
      maxTurns: 1,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    },
  });

  let text = "";
  for await (const msg of q as any) {
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "text") text += block.text;
      }
    } else if (msg.type === "result" && msg.subtype === "success" && !text) {
      text += msg.result ?? "";
    }
  }
  return parseJson(text);
}

function ask(instructions: string, user: string): Promise<any> {
  return JUDGE_ON_SUBSCRIPTION ? askViaAgentSdk(instructions, user) : askViaApi(instructions, user);
}

export interface JudgeResult {
  pass: boolean;
  reason: string;
  unsupported?: string[];
}

/**
 * Grade whether every technical claim in `answer` is supported by the manual.
 * Numbers (duty-cycle %, amps, polarity) must match exactly; a claim that is
 * absent from or contradicts the manual is a FAIL (i.e. a hallucination).
 */
export async function judgeGrounded(question: string, answer: string): Promise<JudgeResult> {
  const instructions =
    "You are a STRICT technical grader for a welding-manual assistant. You are given the " +
    "owner's manual (ground truth), a user QUESTION, and the assistant's ANSWER. Decide " +
    "whether every technical claim in the ANSWER is directly supported by the manual.\n" +
    "- Numeric claims (duty-cycle %, amperage, voltage, wire size, socket polarity) must " +
    "match the manual EXACTLY. A wrong or invented number is a FAIL.\n" +
    "- A claim that is absent from or contradicts the manual is a FAIL (hallucination).\n" +
    "- Ignore tone, markdown, and any references to images/diagrams/artifacts the answer " +
    "says it rendered (you cannot see them) — grade only the factual text.\n" +
    'Reply with ONLY JSON: {"verdict":"PASS"|"FAIL","unsupported":["claim",...],"reason":"one sentence"}.';
  const r = await ask(instructions, `QUESTION:\n${question}\n\nANSWER:\n${answer}`);
  return { pass: r.verdict === "PASS", reason: r.reason ?? "", unsupported: r.unsupported ?? [] };
}

/**
 * Grade a behavioral expectation: either the answer should ask ONE clarifying
 * question (ambiguous input) or decline because the info isn't in the manual.
 */
export async function judgeBehavior(
  question: string,
  answer: string,
  kind: "clarify" | "refuse",
): Promise<JudgeResult> {
  const rule =
    kind === "clarify"
      ? "The QUESTION is ambiguous (a value the answer depends on — process, voltage, material, or thickness — is missing). PASS only if the ANSWER asks the user a clarifying question instead of committing to a specific numeric answer. FAIL if it guesses/picks values and answers as if unambiguous."
      : "The QUESTION asks about something NOT covered by this welder's manual. PASS only if the ANSWER declines / says it isn't in the manual and does NOT invent a procedure, spec, or part. FAIL if it fabricates an answer.";
  const instructions =
    "You grade an assistant's BEHAVIOR against the owner's manual (ground truth).\n" +
    rule +
    '\nReply with ONLY JSON: {"verdict":"PASS"|"FAIL","reason":"one sentence"}.';
  const r = await ask(instructions, `QUESTION:\n${question}\n\nANSWER:\n${answer}`);
  return { pass: r.verdict === "PASS", reason: r.reason ?? "" };
}
