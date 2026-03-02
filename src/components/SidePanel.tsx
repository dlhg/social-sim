import { useEffect, useRef } from "react";
import { CharacterViewer } from "./CharacterViewer";
import type { NPC, ConversationMessage, ActivityEvent, EmotionalState } from "../types";

export type TabId = "feed" | "characters";

export interface NpcSnapshot {
  timestamp: number;
  emotions: EmotionalState;
  relationships: Record<string, number>;
}

export type FeedItem =
  | { type: "chat"; msg: ConversationMessage; timestamp: number }
  | { type: "activity"; event: ActivityEvent };

interface SidePanelProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  npcs: NPC[];
  feed: FeedItem[];
  currentSpeaker: string | null;
  selectedNpcId: string | null;
  onSelectNpc: (id: string | null) => void;
  npcHistory: Record<string, NpcSnapshot[]>;
}

const TABS: { id: TabId; label: string }[] = [
  { id: "feed", label: "Feed" },
  { id: "characters", label: "NPCs" },
];

function formatTime(date: Date) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function SidePanel({
  activeTab,
  onTabChange,
  npcs,
  feed,
  currentSpeaker,
  selectedNpcId,
  onSelectNpc,
  npcHistory,
}: SidePanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeTab === "feed") {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [feed, currentSpeaker, activeTab]);

  const npcMap = Object.fromEntries(npcs.map((n) => [n.id, n]));

  return (
    <div className="side-panel">
      <div className="tab-bar">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn${activeTab === tab.id ? " active" : ""}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {activeTab === "feed" && (
          <>
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
          </>
        )}

        {activeTab === "characters" && (
          <CharacterViewer
            npcs={npcs}
            selectedNpcId={selectedNpcId}
            onSelectNpc={onSelectNpc}
            npcHistory={npcHistory}
          />
        )}
      </div>
    </div>
  );
}
