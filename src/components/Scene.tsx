import type { NPC, ConversationMessage } from "../types";

interface SceneProps {
  npcs: NPC[];
  currentSpeaker: string | null;
  streamingText: Record<string, string>;
  lastMessages: Record<string, ConversationMessage>;
}

export function Scene({
  npcs,
  currentSpeaker,
  streamingText,
  lastMessages,
}: SceneProps) {
  return (
    <div className="scene">
      <div className="scene-bg" />
      <div className="characters">
        {npcs.map((npc) => {
          const isSpeaking = currentSpeaker === npc.id;
          // During accumulation show thinking dots only; after turn complete show speech
          const bubbleText = isSpeaking
            ? null // thinking dots shown below instead
            : lastMessages[npc.id]?.text || null;

          return (
            <div
              key={npc.id}
              className={`character ${isSpeaking ? "speaking" : ""}`}
            >
              {bubbleText && (
                <div
                  className="speech-bubble faded"
                  style={{ borderColor: npc.color }}
                >
                  {bubbleText}
                </div>
              )}
              <div className="avatar" style={{ borderColor: npc.color }}>
                <span className="avatar-emoji">{npc.avatar}</span>
              </div>
              <div className="char-name" style={{ color: npc.color }}>
                {npc.name}
              </div>
              {isSpeaking && (
                <div className="thinking-dots">
                  <span />
                  <span />
                  <span />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
