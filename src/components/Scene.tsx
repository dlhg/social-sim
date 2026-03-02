import { characters } from "../characters";
import type { ConversationMessage } from "../simulation";

interface SceneProps {
  currentSpeaker: string | null;
  streamingText: Record<string, string>;
  lastMessages: Record<string, ConversationMessage>;
}

export function Scene({ currentSpeaker, streamingText, lastMessages }: SceneProps) {
  return (
    <div className="scene">
      <div className="scene-bg" />
      <div className="characters">
        {characters.map((char) => {
          const isSpeaking = currentSpeaker === char.id;
          const bubbleText = isSpeaking
            ? streamingText[char.id] || "..."
            : lastMessages[char.id]?.text || null;

          return (
            <div key={char.id} className={`character ${isSpeaking ? "speaking" : ""}`}>
              {bubbleText && (
                <div
                  className={`speech-bubble ${isSpeaking ? "active" : "faded"}`}
                  style={{ borderColor: char.color }}
                >
                  {bubbleText}
                </div>
              )}
              <div className="avatar" style={{ borderColor: char.color }}>
                <span className="avatar-emoji">{char.avatar}</span>
              </div>
              <div className="char-name" style={{ color: char.color }}>
                {char.name}
              </div>
              {isSpeaking && <div className="thinking-dots"><span /><span /><span /></div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
