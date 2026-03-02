import { useEffect, useRef } from "react";
import { CharacterViewer } from "./CharacterViewer";
import type { NPC, ConversationMessage, ActivityEvent, EmotionalState } from "../types";

export type TabId = "chat" | "activity" | "characters";

export interface NpcSnapshot {
  timestamp: number;
  emotions: EmotionalState;
  relationships: Record<string, number>;
}

interface SidePanelProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  npcs: NPC[];
  messages: ConversationMessage[];
  currentSpeaker: string | null;
  events: ActivityEvent[];
  selectedNpcId: string | null;
  onSelectNpc: (id: string | null) => void;
  npcHistory: Record<string, NpcSnapshot[]>;
}

const TABS: { id: TabId; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "activity", label: "Activity" },
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
  messages,
  currentSpeaker,
  events,
  selectedNpcId,
  onSelectNpc,
  npcHistory,
}: SidePanelProps) {
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const activityBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeTab === "chat") {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, currentSpeaker, activeTab]);

  useEffect(() => {
    if (activeTab === "activity") {
      activityBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [events, activeTab]);

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
        {activeTab === "chat" && (
          <>
            {messages.map((msg, i) => {
              const npc = npcMap[msg.npcId];
              return (
                <div key={i} className="chat-entry">
                  <span className="chat-name" style={{ color: npc?.color }}>
                    {msg.npcName}:
                  </span>{" "}
                  <span className="chat-text">{msg.text}</span>
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
            <div ref={chatBottomRef} />
          </>
        )}

        {activeTab === "activity" && (
          <>
            {events.map((evt, i) => (
              <div key={i} className="activity-entry">
                <span className="activity-time">{formatTime(evt.timestamp)}</span>{" "}
                <span className="activity-text">{evt.text}</span>
              </div>
            ))}
            <div ref={activityBottomRef} />
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
