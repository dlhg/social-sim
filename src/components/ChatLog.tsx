import { useEffect, useRef } from "react";
import { characters } from "../characters";
import type { ConversationMessage } from "../simulation";

interface ChatLogProps {
  messages: ConversationMessage[];
  streamingText: Record<string, string>;
  currentSpeaker: string | null;
}

export function ChatLog({ messages, streamingText, currentSpeaker }: ChatLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  const charMap = Object.fromEntries(characters.map((c) => [c.id, c]));

  return (
    <div className="hud-panel chat-log">
      <div className="hud-title">Chat Log</div>
      <div className="hud-content">
        {messages.map((msg, i) => {
          const char = charMap[msg.characterId];
          return (
            <div key={i} className="chat-entry">
              <span className="chat-name" style={{ color: char?.color }}>
                {msg.characterName}:
              </span>{" "}
              <span className="chat-text">{msg.text}</span>
            </div>
          );
        })}
        {currentSpeaker && streamingText[currentSpeaker] && (
          <div className="chat-entry streaming">
            <span className="chat-name" style={{ color: charMap[currentSpeaker]?.color }}>
              {charMap[currentSpeaker]?.name}:
            </span>{" "}
            <span className="chat-text">{streamingText[currentSpeaker]}</span>
            <span className="cursor-blink">|</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
