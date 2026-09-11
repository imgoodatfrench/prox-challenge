import { runAgent } from "@/lib/agent";
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
      const emit = (part: Part) => send({ type: "part", part });

      let sessionSent = false;
      let doneSent = false;
      const done = (stats?: TurnStats) => {
        if (doneSent) return;
        doneSent = true;
        send({ type: "done", stats });
      };

      try {
        const q = runAgent({
          prompt: message,
          sessionId: body.sessionId,
          emit,
          signal: req.signal,
        });

        for await (const msg of q) {
          // Surface the session id once so the client can continue the thread.
          if (!sessionSent && "session_id" in msg && msg.session_id) {
            sessionSent = true;
            send({ type: "session", sessionId: msg.session_id });
          }

          if (msg.type === "stream_event") {
            const ev = msg.event;
            if (
              ev.type === "content_block_delta" &&
              ev.delta.type === "text_delta" &&
              ev.delta.text
            ) {
              send({ type: "text", value: ev.delta.text });
            }
            continue;
          }

          if (msg.type === "result") {
            const stats: TurnStats = {};
            if (msg.subtype === "success") {
              stats.cacheReadTokens = msg.usage?.cache_read_input_tokens;
              stats.inputTokens = msg.usage?.input_tokens;
              if (typeof msg.total_cost_usd === "number") stats.costUsd = msg.total_cost_usd;
            } else {
              send({
                type: "error",
                value:
                  "The agent ended without completing this turn " +
                  `(${msg.subtype}). Please try again.`,
              });
            }
            done(stats);
          }
        }
        // Defensive: if the stream ended without a terminal `result`
        // (e.g. an abort), still release the client from its loading state.
        done();
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        send({ type: "error", value: friendlyError(detail) });
        done();
      } finally {
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
