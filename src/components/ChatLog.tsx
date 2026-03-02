import { useEffect, useRef } from "react";
import type { NPC, ConversationMessage } from "../types";

interface ChatLogProps {
  npcs: NPC[];
  messages: ConversationMessage[];
  currentSpeaker: string | null;
}

export function ChatLog({ npcs, messages, currentSpeaker }: ChatLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentSpeaker]);

  const npcMap = Object.fromEntries(npcs.map((n) => [n.id, n]));

  return (
    <div className="hud-panel chat-log">
      <div className="hud-title">Chat Log</div>
      <div className="hud-content">
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
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
