"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RenderMessage, RenderPart, StreamEvent, TurnStats } from "@/lib/types";
import type { Conversation } from "@/lib/conversations";
import {
  deriveTitle,
  loadConversations,
  newConversation,
  saveConversations,
} from "@/lib/conversations";
import { useSpeechRecognition } from "./useSpeechRecognition";
import MessageParts from "./MessageParts";
import Sidebar from "./Sidebar";

const STARTERS = [
  "What's the duty cycle for MIG welding at 200A on 240V?",
  "I'm getting porosity in my flux-cored welds. What should I check?",
  "What polarity setup do I need for TIG welding? Which socket does the ground clamp go in?",
];

// Prox four-point sparkle mark.
function Sparkle({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 1.5c.5 4.4 1.8 7.2 4.1 8.9 1.5 1.1 3.7 1.8 6.4 2.1-2.7.3-4.9 1-6.4 2.1-2.3 1.7-3.6 4.5-4.1 8.9-.5-4.4-1.8-7.2-4.1-8.9-1.5-1.1-3.7-1.8-6.4-2.1 2.7-.3 4.9-1 6.4-2.1C10.2 8.7 11.5 5.9 12 1.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function Chat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dictateBase = useRef("");

  // ---- Hydrate from localStorage (client only) ----
  useEffect(() => {
    const loaded = loadConversations();
    if (loaded.length > 0) {
      loaded.sort((a, b) => b.updatedAt - a.updatedAt);
      setConversations(loaded);
      setActiveId(loaded[0].id);
    } else {
      const c = newConversation();
      setConversations([c]);
      setActiveId(c.id);
    }
    setHydrated(true);
  }, []);

  // ---- Persist on change ----
  useEffect(() => {
    if (hydrated) saveConversations(conversations);
  }, [conversations, hydrated]);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );
  const messages = active?.messages ?? [];
  const busy = activeId != null && busyIds.includes(activeId);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Only stick to the bottom when the user is already near it, so streaming
    // tokens don't yank them up while they read earlier content.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) el.scrollTo({ top: el.scrollHeight });
  }, [messages, busy, activeId]);

  // ---- Conversation-scoped updates (route streaming by id, not by "active") ----
  const patch = useCallback((id: string, fn: (c: Conversation) => Conversation) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));
  }, []);

  const updateAssistant = useCallback(
    (id: string, fn: (parts: RenderPart[]) => RenderPart[]) => {
      patch(id, (c) => {
        if (c.messages.length === 0) return c;
        const msgs = c.messages.slice();
        const last = msgs[msgs.length - 1];
        if (last.role !== "assistant") return c;
        msgs[msgs.length - 1] = { ...last, parts: fn(last.parts.slice()) };
        return { ...c, messages: msgs };
      });
    },
    [patch],
  );

  const appendText = useCallback(
    (id: string, text: string) => {
      updateAssistant(id, (parts) => {
        const last = parts[parts.length - 1];
        if (last && last.kind === "text") {
          parts[parts.length - 1] = { kind: "text", text: last.text + text };
        } else {
          parts.push({ kind: "text", text });
        }
        return parts;
      });
    },
    [updateAssistant],
  );

  const handleEvent = useCallback(
    (id: string, ev: StreamEvent) => {
      switch (ev.type) {
        case "session":
          patch(id, (c) => ({ ...c, sdkSessionId: ev.sessionId }));
          break;
        case "text":
          appendText(id, ev.value);
          break;
        case "part":
          updateAssistant(id, (parts) => {
            parts.push(ev.part);
            return parts;
          });
          break;
        case "error":
          appendText(id, `\n\n⚠ ${ev.value}`);
          break;
        case "done":
          if (ev.stats) patch(id, (c) => ({ ...c, lastStats: ev.stats as TurnStats }));
          break;
      }
    },
    [appendText, updateAssistant, patch],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      const id = activeId;
      if (!trimmed || id == null || busyIds.includes(id)) return;

      setInput("");
      const now = Date.now();
      const userMsg: RenderMessage = { role: "user", parts: [{ kind: "text", text: trimmed }] };
      const resumeSession = active?.sdkSessionId ?? null;

      patch(id, (c) => ({
        ...c,
        title: c.title === "New chat" ? deriveTitle(trimmed) : c.title,
        messages: [...c.messages, userMsg, { role: "assistant", parts: [] }],
        lastStats: null,
        updatedAt: now,
      }));
      setBusyIds((b) => [...b, id]);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, sessionId: resumeSession }),
        });
        if (!res.body) throw new Error("no response stream");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const line = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            let ev: StreamEvent;
            try {
              ev = JSON.parse(line.slice(5).trim()) as StreamEvent;
            } catch {
              continue;
            }
            handleEvent(id, ev);
          }
        }
      } catch (err) {
        appendText(id, `\n\n⚠ ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        patch(id, (c) => ({ ...c, updatedAt: Date.now() }));
        setBusyIds((b) => b.filter((x) => x !== id));
      }
    },
    [activeId, active, busyIds, patch, handleEvent, appendText],
  );

  // ---- Voice-to-text (Web Speech API) ----
  const { supported: micSupported, listening, error: micError, start, stop } =
    useSpeechRecognition((chunk, isFinal) => {
      if (isFinal) {
        dictateBase.current = `${dictateBase.current} ${chunk}`.trim();
        setInput(dictateBase.current);
      } else {
        setInput(`${dictateBase.current} ${chunk}`.trim());
      }
    });

  const toggleMic = () => {
    if (listening) {
      stop();
    } else {
      dictateBase.current = input.trim();
      start();
    }
  };

  // ---- Sidebar actions ----
  const handleNew = useCallback(() => {
    // Reuse an existing pristine "New chat" instead of piling up empties.
    const pristine = conversations.find((c) => c.messages.length === 0);
    if (pristine) {
      setActiveId(pristine.id);
    } else {
      const c = newConversation();
      setConversations((prev) => [c, ...prev]);
      setActiveId(c.id);
    }
    setSidebarOpen(false);
    setInput("");
  }, [conversations]);

  const handleSelect = useCallback((id: string) => {
    setActiveId(id);
    setSidebarOpen(false);
    setInput("");
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        if (next.length === 0) {
          const c = newConversation();
          setActiveId(c.id);
          return [c];
        }
        if (id === activeId) setActiveId(next[0].id);
        return next;
      });
    },
    [activeId],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const lastMsg = messages[messages.length - 1];
  const awaitingFirstToken =
    busy && lastMsg?.role === "assistant" && lastMsg.parts.length === 0;
  const stats = active?.lastStats ?? null;

  return (
    <div className="shell">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        open={sidebarOpen}
        onSelect={handleSelect}
        onNew={handleNew}
        onDelete={handleDelete}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="main">
        <header className="header">
          <button
            className="menu-btn"
            aria-label="Toggle conversations"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <span className="mark">
            <Sparkle />
          </span>
          <div className="titles">
            <h1>Vulcan OmniPro 220</h1>
            <p className="sub">Multimodal expert agent · Claude Agent SDK</p>
          </div>
          {stats?.cacheReadTokens != null && (
            <span className="badge" title="Cached manual tokens read this turn">
              cache {Math.round(stats.cacheReadTokens / 1000)}k tok
              {stats.costUsd != null ? ` · $${stats.costUsd.toFixed(4)}` : ""}
            </span>
          )}
        </header>

        <div className="messages" ref={scrollRef}>
          <div className="thread">
            {messages.length === 0 ? (
              <div className="empty">
                <span className="mark-lg">
                  <Sparkle size={24} />
                </span>
                <h2>How can I help with your welder?</h2>
                <p>
                  Ask about setup, duty cycles, polarity, or troubleshooting — I answer with
                  images, diagrams, and interactive tools, not just text.
                </p>
                <div className="starters">
                  {STARTERS.map((s) => (
                    <button key={s} className="starter" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="msg user">
                    <div className="bubble">
                      {m.parts.map((p) => (p.kind === "text" ? p.text : "")).join("")}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="msg assistant">
                    <span className="avatar">
                      <Sparkle size={16} />
                    </span>
                    <div className="assistant-card">
                      {m.parts.length === 0 && i === messages.length - 1 && awaitingFirstToken ? (
                        <div className="typing" aria-label="Thinking">
                          <span />
                          <span />
                          <span />
                        </div>
                      ) : (
                        <MessageParts parts={m.parts} />
                      )}
                    </div>
                  </div>
                ),
              )
            )}
          </div>
        </div>

        <div className="composer-wrap">
          <div className="thread">
            <div className={`composer ${listening ? "listening" : ""}`}>
              {micSupported && (
                <button
                  className={`mic ${listening ? "on" : ""}`}
                  onClick={toggleMic}
                  aria-label={listening ? "Stop dictation" : "Dictate with microphone"}
                  title={listening ? "Stop dictation" : "Dictate"}
                  type="button"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
                    <path
                      d="M6 11a6 6 0 0012 0M12 17v4M8.5 21h7"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      fill="none"
                    />
                  </svg>
                </button>
              )}
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={listening ? "Listening…" : "Ask about your OmniPro 220…"}
                rows={1}
              />
              <button
                className="send"
                onClick={() => send(input)}
                disabled={busy || !input.trim()}
                aria-label="Send message"
                type="button"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 19V5M12 5l-6 6M12 5l6 6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
            <p className="disclaimer">
              {micError
                ? `Mic: ${micError}`
                : listening
                  ? "Listening — click the mic again to stop."
                  : "Answers cite the OmniPro 220 manual · verify torque and safety specs before welding."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
