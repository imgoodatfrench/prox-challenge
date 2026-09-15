import { runAgent } from "@/lib/agent";
import { MANUAL_SERVER } from "@/lib/tools";
import { checkToolsReady, isMissingSessionError } from "@/lib/turn-guards";
import type { Part, StreamEvent, TurnStats } from "@/lib/types";

// The Agent SDK spawns the Claude Code runtime as a subprocess — this route
// must run on Node.js (never edge) and stay dynamic/long-lived.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ChatBody {
  message?: string;
  sessionId?: string;
}

export async function POST(req: Request): Promise<Response> {
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (ev: StreamEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };

      let doneSent = false;
      const done = (stats?: TurnStats) => {
        if (doneSent) return;
        doneSent = true;
        send({ type: "done", stats });
      };

      /**
       * Run one turn. Returns "retry-fresh" when the session we tried to
       * resume no longer exists on this server and nothing has been streamed
       * yet, so the caller can rerun without `resume`.
       */
      const runTurn = async (sessionId: string | undefined): Promise<"ok" | "retry-fresh"> => {
        // Anything visible streamed to the client for this attempt yet?
        let turnStarted = false;
        let sessionSent = false;
        // A non-success `result` is held until the iterator finishes so a
        // recoverable missing-session error can be retried silently.
        let pendingError: string | null = null;
        let stats: TurnStats | undefined;

        const emit = (part: Part) => {
          turnStarted = true;
          send({ type: "part", part });
        };

        try {
          const q = runAgent({ prompt: message, sessionId, emit, signal: req.signal });

          for await (const msg of q) {
            // Surface the session id once so the client can continue the thread.
            if (!sessionSent && "session_id" in msg && msg.session_id) {
              sessionSent = true;
              send({ type: "session", sessionId: msg.session_id });
            }

            // Confirm the multimodal tools are actually registered for this
            // turn — otherwise the model's tool calls fail and it falls back to
            // text with "my drawing tools aren't responding".
            if (msg.type === "system" && msg.subtype === "init") {
              const ready = checkToolsReady(msg, MANUAL_SERVER);
              if (!ready.ok) {
                console.error(`[chat] visual tools not ready this turn: ${ready.reason}`);
                send({
                  type: "error",
                  value:
                    "The visual tools (diagrams, manual images, interactive artifacts) " +
                    `didn't start for this turn (${ready.reason}). This answer may be ` +
                    "text-only — please ask again.",
                });
              }
              continue;
            }

            if (msg.type === "stream_event") {
              const ev = msg.event;
              if (
                ev.type === "content_block_delta" &&
                ev.delta.type === "text_delta" &&
                ev.delta.text
              ) {
                turnStarted = true;
                send({ type: "text", value: ev.delta.text });
              }
              continue;
            }

            if (msg.type === "result") {
              if (msg.subtype === "success") {
                stats = {};
                stats.cacheReadTokens = msg.usage?.cache_read_input_tokens;
                stats.inputTokens = msg.usage?.input_tokens;
                if (typeof msg.total_cost_usd === "number") stats.costUsd = msg.total_cost_usd;
              } else {
                pendingError =
                  "The agent ended without completing this turn " +
                  `(${msg.subtype}). Please try again.`;
              }
            }
          }
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          // The client kept an sdkSessionId from before a redeploy/restart and
          // the transcript is gone. Start a fresh session instead of failing
          // this thread forever.
          if (sessionId && !turnStarted && isMissingSessionError(detail)) {
            console.warn(`[chat] session ${sessionId} not found on this server; starting fresh`);
            return "retry-fresh";
          }
          send({ type: "error", value: friendlyError(detail) });
          done();
          return "ok";
        }

        if (pendingError) send({ type: "error", value: pendingError });
        // Defensive: if the stream ended without a terminal `result`
        // (e.g. an abort), still release the client from its loading state.
        done(stats);
        return "ok";
      };

      try {
        const outcome = await runTurn(body.sessionId || undefined);
        if (outcome === "retry-fresh") {
          send({
            type: "text",
            value:
              "_(The previous session expired on the server, so I'm starting a fresh one — " +
              "earlier messages in this thread aren't in my context.)_\n\n",
          });
          await runTurn(undefined);
        }
      } finally {
        done();
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Turn common setup failures into something actionable in the UI. */
function friendlyError(detail: string): string {
  if (/kb\/manual\.md not found/i.test(detail) || /run .?npm run ingest/i.test(detail)) {
    return (
      "The knowledge base isn't built yet. Run `npm run ingest` once (with your " +
      "ANTHROPIC_API_KEY set) to extract the manuals into kb/manual.md, then retry."
    );
  }
  if (/ANTHROPIC_API_KEY/i.test(detail) || /api key/i.test(detail)) {
    return "No Anthropic API key found. Copy .env.example to .env and set ANTHROPIC_API_KEY.";
  }
  return `Something went wrong: ${detail}`;
}
