import { useEffect, useRef } from "react";
import type { NPC, ConversationMessage, ActivityEvent, EmotionalState } from "../types";

export interface NpcSnapshot {
  timestamp: number;
  emotions: EmotionalState;
  relationships: Record<string, number>;
}

export type FeedItem =
  | { type: "chat"; msg: ConversationMessage; timestamp: number }
  | { type: "activity"; event: ActivityEvent };

export type PanelMode = "collapsed" | "partial" | "expanded";

interface FeedPanelProps {
  npcs: NPC[];
  feed: FeedItem[];
  currentSpeaker: string | null;
  panelMode: PanelMode;
  onTogglePanel: () => void;
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
  panelMode,
  onTogglePanel,
}: FeedPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (panelMode !== "collapsed") {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [feed, currentSpeaker, panelMode]);

  const npcMap = Object.fromEntries(npcs.map((n) => [n.id, n]));

  return (
    <div className="feed-overlay">
      <div className="feed-header">
        <span className="feed-label">Feed</span>
        <button className="panel-toggle" onClick={onTogglePanel}>
          {panelMode === "expanded" ? "▴" : "▾"}
        </button>
      </div>

      <div className={`feed-content ${panelMode}`}>
        {feed.map((item, i) => {
          if (item.type === "chat") {
            const npc = npcMap[item.msg.npcId];
            return (
              <div key={i} className="chat-entry">
                <span className="chat-name" style={{ color: npc?.color }}>
                  {item.msg.npcName}:
                </span>{" "}
                <span className="chat-text">{item.msg.text}</span>
              </div>
            );
          }
          const activityClass = item.event.activityType
            ? `activity-entry activity-${item.event.activityType}`
            : "activity-entry";
          return (
            <div key={i} className={activityClass}>
              <span className="activity-time">
                {formatTime(item.event.timestamp)}
              </span>{" "}
              <span className="activity-text">{item.event.text}</span>
            </div>
          );
        })}
        {currentSpeaker && (
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
