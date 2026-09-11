// Wire protocol between the /api/chat SSE stream and the client.
// Kept as a small tagged union so multimodal part types (manual_image,
// diagram, artifact) can be added later without breaking the text path.

export type ChatRole = "user" | "assistant";

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

// A multimodal "part" the agent renders alongside its text. The server emits
// these in stream order (interleaved with `text` events); the client assembles
// them into one ordered assistant message so text·image·diagram·artifact appear
// in the sequence the model produced them.
export type Part =
  | {
      kind: "manual_image";
      /** page id, e.g. "owner-manual-p12" */
      id: string;
      /** URL the client loads the PNG from (served by /api/manual-image) */
      src: string;
      caption: string;
      /** human doc title + page number for the citation line */
      doc?: string;
      page?: number;
    }
  | { kind: "diagram"; title: string; svg: string }
  | { kind: "artifact"; title: string; runtime: "react" | "html"; code: string };

// Usage surfaced at the end of a turn — mainly to make the stuffing/caching
// thesis observable (cacheReadTokens > 0 on turn 2 means the manual prefix hit).
export interface TurnStats {
  cacheReadTokens?: number;
  inputTokens?: number;
  costUsd?: number;
}

export type StreamEvent =
  | { type: "session"; sessionId: string }
  | { type: "text"; value: string }
  | { type: "part"; part: Part }
  | { type: "done"; stats?: TurnStats }
  | { type: "error"; value: string };

// Client-side: text and multimodal parts, interleaved in the order the model
// produced them. The renderer walks this list top to bottom.
export type RenderPart = { kind: "text"; text: string } | Part;

export interface RenderMessage {
  role: ChatRole;
  parts: RenderPart[];
}
