import { useCallback, useEffect, useRef, useState } from "react";
import type { NPC, ConversationMessage, ActivityEvent, EmotionalState, ActivityType } from "../types";

export interface NpcSnapshot {
  timestamp: number;
  emotions: EmotionalState;
  relationships: Record<string, { regard: number; affection: number }>;
}

export type FeedItem =
  | { type: "chat"; msg: ConversationMessage; timestamp: number }
  | { type: "activity"; event: ActivityEvent };

type FilterKey = "chat" | ActivityType | "system" | "prompt";

const FILTER_LABELS: Record<FilterKey, string> = {
  chat: "Chat",
  thought: "Thoughts",
  eavesdrop: "Eavesdrop",
  action: "Actions",
  plan: "Plans",
  system: "System",
  prompt: "Prompts",
};

const FILTER_COLORS: Record<FilterKey, string> = {
  chat: "#e2e0ea",
  thought: "#b0a0cc",
  eavesdrop: "#a876c4",
  action: "#e0a84c",
  plan: "#5cb87a",
  system: "#9896a8",
  prompt: "#6ca6d9",
};

const ALL_FILTERS: FilterKey[] = ["chat", "thought", "eavesdrop", "action", "plan", "system", "prompt"];

function getFilterKey(item: FeedItem): FilterKey {
  if (item.type === "chat") return "chat";
  return item.event.activityType ?? "system";
}

interface FeedPanelProps {
  npcs: NPC[];
  feed: FeedItem[];
  currentSpeaker: string | null;
  onOpenDirector?: () => void;
}

function formatTime(date: Date) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function FeedPanel({
  npcs,
  feed,
  currentSpeaker,
  onOpenDirector,
}: FeedPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(
    () => new Set(ALL_FILTERS.filter(k => k !== "prompt"))
  );
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [openPrompts, setOpenPrompts] = useState<Set<string>>(() => new Set());
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [feed, currentSpeaker, autoScroll]);

  const toggleFilter = (key: FilterKey) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const [copied, setCopied] = useState(false);
  const npcMap = Object.fromEntries(npcs.map((n) => [n.id, n]));

  const copyLog = useCallback(() => {
    const lines = feed
      .filter((item) => activeFilters.has(getFilterKey(item)))
      .map((item) => {
        if (item.type === "chat") {
          return `${item.msg.npcName}: ${item.msg.text}`;
        }
        return `[${formatTime(item.event.timestamp)}] ${item.event.text}`;
      });
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [feed, activeFilters]);

  return (
    <div className="feed-overlay">
      <div className="feed-header">
        <span className="feed-label">Feed</span>
        <div className="feed-header-buttons">
          {onOpenDirector && (
            <button
              className="feed-copy-pill"
              onClick={onOpenDirector}
            >
              Director
            </button>
          )}
          <button
            className="feed-copy-pill"
            onClick={copyLog}
          >
            {copied ? "Copied!" : "Copy log"}
          </button>
          <button
            className={`feed-autoscroll-pill ${autoScroll ? "active" : ""}`}
            onClick={() => setAutoScroll((v) => !v)}
          >
            {autoScroll ? "Disable autoscroll" : "Enable autoscroll"}
          </button>
          <button
            className={`feed-filter-toggle ${filtersOpen ? "active" : ""}`}
            onClick={() => setFiltersOpen((v) => !v)}
            title="Filter feed"
          >
            ⚙
          </button>
        </div>
      </div>

      {filtersOpen && (
        <div className="feed-filters">
          {ALL_FILTERS.map((key) => (
            <button
              key={key}
              className={`feed-filter-chip ${activeFilters.has(key) ? "on" : "off"}`}
              style={{
                borderColor: activeFilters.has(key) ? FILTER_COLORS[key] : "transparent",
                color: activeFilters.has(key) ? FILTER_COLORS[key] : "#555",
              }}
              onClick={() => toggleFilter(key)}
            >
              {FILTER_LABELS[key]}
            </button>
          ))}
        </div>
      )}

      <div className="feed-content">
        {feed.map((item, i) => {
          const visible = activeFilters.has(getFilterKey(item));
          if (item.type === "chat") {
            const npc = npcMap[item.msg.npcId];
            const showPrompt = activeFilters.has("prompt") && item.msg.systemPrompt;
            const itemKey = `chat-${item.timestamp}-${item.msg.npcId}`;
            const promptOpen = openPrompts.has(itemKey);
            return (
              <div key={itemKey} className={`chat-entry feed-item ${visible ? "feed-item-visible" : "feed-item-hidden"}${promptOpen ? " feed-item-prompt-open" : ""}`}>
                <span className="chat-name" style={{ color: npc?.color }}>
                  {item.msg.npcName}:
                </span>{" "}
                <span className="chat-text">{item.msg.text}</span>
                {showPrompt && (
                  <details
                    className="feed-prompt-details"
                    onToggle={(e) => {
                      const open = (e.target as HTMLDetailsElement).open;
                      setOpenPrompts((prev) => {
                        const next = new Set(prev);
                        if (open) next.add(itemKey);
                        else next.delete(itemKey);
                        return next;
                      });
                    }}
                  >
                    <summary className="feed-prompt-summary">
                      prompt for {item.msg.npcName}
                      <button
                        className="feed-prompt-copy"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          navigator.clipboard.writeText(item.msg.systemPrompt!).then(() => {
                            setCopiedPrompt(itemKey);
                            setTimeout(() => setCopiedPrompt(null), 1500);
                          });
                        }}
                        title="Copy prompt"
                      >
                        {copiedPrompt === itemKey ? "copied!" : "copy"}
                      </button>
                    </summary>
                    <pre className="feed-prompt-content">{item.msg.systemPrompt}</pre>
                  </details>
                )}
              </div>
            );
          }
          const activityClass = item.event.activityType
            ? `activity-entry activity-${item.event.activityType}`
            : "activity-entry";
          return (
            <div key={`act-${+item.event.timestamp}-${item.event.npcId ?? i}`} className={`${activityClass} feed-item ${visible ? "feed-item-visible" : "feed-item-hidden"}`}>
              <span className="activity-time">
                {formatTime(item.event.timestamp)}
              </span>{" "}
              <span className="activity-text">{item.event.text}</span>
            </div>
          );
        })}
        {currentSpeaker && activeFilters.has("chat") && (
          <div className="chat-entry streaming">
            <span
              className="chat-name"
              style={{ color: npcMap[currentSpeaker]?.color }}
            >
              {npcMap[currentSpeaker]?.name}:
            </span>{" "}
            <span className="chat-text">thinking...</span>
            <span className="cursor-blink">|</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
