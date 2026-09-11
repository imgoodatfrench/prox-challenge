// Automated eval for the Vulcan OmniPro 220 agent.
//
// Why this exists: to grade the agent WITHOUT reading the 48-page manual or
// eyeballing answers. Each case is checked on four cheap-to-strong layers:
//   1. modality  — deterministic: did the agent emit the expected visual part?
//   2. anchors   — deterministic: do exact pinned specs appear in the text?
//   3. behavior  — judge: ambiguous -> clarifies, not-in-manual -> refuses
//   4. grounded  — judge: every claim is supported by kb/manual.md (no hallucination)
// Layers 1-2 read nothing. Layers 3-4 use the extracted manual as the oracle.
//
// Runs against the REAL production path: it POSTs to the /api/chat SSE endpoint,
// so start the app first (`npm run dev`) in another terminal, then `npm run eval`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { judgeGrounded, judgeBehavior, JUDGE_ON_SUBSCRIPTION } from "./judge.ts";

const BASE_URL = process.env.EVAL_BASE_URL || "http://localhost:3000";
const CASES_PATH = process.env.EVAL_CASES || join(process.cwd(), "eval", "cases.jsonl");

interface Expect {
  modality?: string[];
  anchors?: string[];
  behavior?: "clarify" | "refuse";
}
interface Case {
  id: string;
  q: string;
  expect?: Expect;
  note?: string;
}
interface Part {
  kind: string;
  [k: string]: unknown;
}
interface AgentRun {
  text: string;
  parts: Part[];
  cacheReadTokens?: number;
  error?: string;
}

/** Drive one turn through the live SSE endpoint, collecting text + parts. */
async function callAgent(question: string): Promise<AgentRun> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: question }),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { text: "", parts: [], error: `cannot reach ${BASE_URL} — is \`npm run dev\` running? (${detail})` };
  }
  if (!res.ok || !res.body) {
    return { text: "", parts: [], error: `HTTP ${res.status} from ${BASE_URL}/api/chat` };
  }

  const run: AgentRun = { text: "", parts: [] };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  const handle = (ev: any) => {
    if (ev.type === "text") run.text += ev.value;
    else if (ev.type === "part") run.parts.push(ev.part);
    else if (ev.type === "done") run.cacheReadTokens = ev.stats?.cacheReadTokens;
    else if (ev.type === "error") run.error = ev.value;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // SSE frames are separated by a blank line.
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          handle(JSON.parse(line.slice(5).trim()));
        } catch {
          /* keepalive or partial — ignore */
        }
      }
    }
  }
  return run;
}

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

async function checkCase(c: Case, run: AgentRun): Promise<Check[]> {
  const checks: Check[] = [];
  if (run.error) {
    return [{ name: "run", pass: false, detail: run.error }];
  }
  const e = c.expect ?? {};
  const kinds = new Set(run.parts.map((p) => p.kind));

  // 1. modality (deterministic, reads nothing)
  if (e.modality?.length) {
    const hit = e.modality.find((k) => kinds.has(k));
    checks.push({
      name: "modality",
      pass: Boolean(hit),
      detail: hit
        ? `got ${hit}`
        : `expected one of [${e.modality.join(", ")}], got [${[...kinds].join(", ") || "text only"}]`,
    });
  }

  // 2. anchors (deterministic exact-spec substrings)
  if (e.anchors?.length) {
    const hay = run.text.toLowerCase();
    const missing = e.anchors.filter((a) => !hay.includes(a.toLowerCase()));
    checks.push({
      name: "anchors",
      pass: missing.length === 0,
      detail: missing.length ? `missing: ${missing.join(", ")}` : `found: ${e.anchors.join(", ")}`,
    });
  }

  // 3 & 4. judge (behavior OR grounded factual support)
  if (e.behavior) {
    const r = await judgeBehavior(c.q, run.text, e.behavior);
    checks.push({ name: e.behavior, pass: r.pass, detail: r.reason });
  } else {
    const r = await judgeGrounded(c.q, run.text);
    checks.push({
      name: "grounded",
      pass: r.pass,
      detail: r.pass ? "supported by manual" : `unsupported: ${(r.unsupported ?? []).join("; ") || r.reason}`,
    });
  }

  return checks;
}

function loadCases(): Case[] {
  return readFileSync(CASES_PATH, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Case);
}

const GREEN = "\x1b[32m", RED = "\x1b[31m", DIM = "\x1b[2m", BOLD = "\x1b[1m", RESET = "\x1b[0m";
const mark = (ok: boolean) => (ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`);

async function main() {
  const only = process.env.EVAL_ONLY?.split(",").map((s) => s.trim());
  let cases = loadCases();
  if (only?.length) cases = cases.filter((c) => only.includes(c.id));

  const auth = JUDGE_ON_SUBSCRIPTION
    ? `${GREEN}subscription${RESET} (no ANTHROPIC_API_KEY — agent + judge on your Claude Code login)`
    : `api key (agent + judge on ANTHROPIC_API_KEY)`;
  console.log(`${BOLD}Vulcan OmniPro 220 — agent eval${RESET}  (${cases.length} cases → ${BASE_URL})`);
  console.log(`${DIM}auth: ${auth}${RESET}\n`);

  let passed = 0;
  let hallucinations = 0;
  let sawCacheHit = false;

  for (const c of cases) {
    process.stdout.write(`${DIM}running ${c.id}…${RESET}`);
    const run = await callAgent(c.q);
    if ((run.cacheReadTokens ?? 0) > 0) sawCacheHit = true;
    const checks = await checkCase(c, run);
    const ok = checks.every((ck) => ck.pass);
    if (ok) passed++;
    if (checks.some((ck) => ck.name === "grounded" && !ck.pass)) hallucinations++;

    process.stdout.write("\r\x1b[K"); // clear the "running…" line
    console.log(`${mark(ok)} ${BOLD}${c.id}${RESET}`);
    for (const ck of checks) {
      console.log(`    ${mark(ck.pass)} ${ck.name.padEnd(9)} ${DIM}${ck.detail}${RESET}`);
    }
    // EVAL_VERBOSE=1 dumps the agent's actual answer so you can diagnose a
    // failure without re-reading the manual yourself.
    if (process.env.EVAL_VERBOSE && !run.error) {
      const kinds = run.parts.map((p) => p.kind).join(", ") || "none";
      console.log(`    ${DIM}Q: ${c.q}${RESET}`);
      console.log(`    ${DIM}parts: [${kinds}]${RESET}`);
      console.log(run.text.split("\n").map((l) => `    │ ${l}`).join("\n"));
    }
  }

  const total = cases.length;
  console.log(`\n${BOLD}${passed}/${total} cases passed${RESET}` +
    `  ·  ${hallucinations} hallucination${hallucinations === 1 ? "" : "s"}` +
    `  ·  cache prefix hit: ${sawCacheHit ? `${GREEN}yes${RESET}` : `${RED}NOT observed${RESET}`}`);

  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
