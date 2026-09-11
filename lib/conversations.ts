// Client-side conversation store. Multiple chat threads (ChatGPT/Claude-style)
// persist in localStorage — there's no server DB; the Agent SDK already carries
// multi-turn continuity via the per-thread `sdkSessionId` we replay on each turn.
import type { RenderMessage, TurnStats } from "./types";

export interface Conversation {
  id: string;
  title: string;
  messages: RenderMessage[];
  /** Agent SDK session id, so continuing this thread resumes its context. */
  sdkSessionId: string | null;
  /** Last turn's usage, shown as the cache/cost badge for this thread. */
  lastStats: TurnStats | null;
  createdAt: number;
  updatedAt: number;
}

const KEY = "omnipro.conversations.v1";

export function uid(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newConversation(): Conversation {
  const now = Date.now();
  return {
    id: uid(),
    title: "New chat",
    messages: [],
    sdkSessionId: null,
    lastStats: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** First user message → a short thread title. */
export function deriveTitle(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return "New chat";
  return t.length > 44 ? `${t.slice(0, 44).trimEnd()}…` : t;
}

export function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is Conversation =>
        !!c &&
        typeof (c as Conversation).id === "string" &&
        Array.isArray((c as Conversation).messages),
    );
  } catch {
    return [];
  }
}

export function saveConversations(convs: Conversation[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(convs));
  } catch {
    /* quota exceeded / private mode — the app still works in-memory */
  }
}

export function relativeTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
