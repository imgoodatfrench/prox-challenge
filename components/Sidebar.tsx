"use client";

import type { Conversation } from "@/lib/conversations";
import { relativeTime } from "@/lib/conversations";

function Sparkle({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 1.5c.5 4.4 1.8 7.2 4.1 8.9 1.5 1.1 3.7 1.8 6.4 2.1-2.7.3-4.9 1-6.4 2.1-2.3 1.7-3.6 4.5-4.1 8.9-.5-4.4-1.8-7.2-4.1-8.9-1.5-1.1-3.7-1.8-6.4-2.1 2.7-.3 4.9-1 6.4-2.1C10.2 8.7 11.5 5.9 12 1.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  open: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export default function Sidebar({
  conversations,
  activeId,
  open,
  onSelect,
  onNew,
  onDelete,
  onClose,
}: SidebarProps) {
  return (
    <>
      <div className={`scrim ${open ? "show" : ""}`} onClick={onClose} aria-hidden="true" />
      <aside className={`sidebar ${open ? "open" : ""}`} aria-label="Conversations">
        <div className="sidebar-head">
          <div className="brand">
            <span className="brand-mark">
              <Sparkle size={15} />
            </span>
            <span className="brand-name">OmniPro&nbsp;220</span>
          </div>
          <button className="new-chat" onClick={onNew}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            New chat
          </button>
        </div>

        <nav className="conv-list">
          {conversations.length === 0 ? (
            <p className="conv-empty">No conversations yet.</p>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                className={`conv-item ${c.id === activeId ? "active" : ""}`}
                onClick={() => onSelect(c.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(c.id);
                  }
                }}
              >
                <div className="conv-text">
                  <span className="conv-title">{c.title}</span>
                  <span className="conv-time">{relativeTime(c.updatedAt)}</span>
                </div>
                <button
                  className="conv-del"
                  aria-label="Delete conversation"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(c.id);
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0v12a1 1 0 01-1 1H7a1 1 0 01-1-1V7"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            ))
          )}
        </nav>

        <div className="sidebar-foot">Built on the Claude Agent SDK</div>
      </aside>
    </>
  );
}
