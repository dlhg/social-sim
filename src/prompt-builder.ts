import type { NPC, EmotionalState, ConversationSession } from "./types";
import type { ChatMessage } from "./ollama";

export function buildSystemPrompt(speaker: NPC, listener: NPC): string {
  const relationship = speaker.relationships[listener.id] ?? 0;
  const relLabel = relationshipLabel(relationship);
  const emotionSummary = describeEmotions(speaker.emotionalState);

  const relevantMemories = speaker.shortTermMemory
    .filter((m) => m.involvedNpcIds.includes(listener.id))
    .sort((a, b) => b.recency * b.importance - a.recency * a.importance)
    .slice(0, 5)
    .map((m) => `- ${m.text}`)
    .join("\n");

  return `You are ${speaker.name}.

PERSONALITY: ${speaker.personalityTraits.join(", ")}
CORE DESIRES: ${speaker.coreDesires.join(", ")}
CURRENT EMOTIONAL STATE: ${emotionSummary}
CURRENT GOAL: ${speaker.currentGoal ?? "none"}

You are talking to ${listener.name}.
YOUR RELATIONSHIP WITH ${listener.name}: ${relLabel} (${relationship.toFixed(2)})

RECENT MEMORIES OF ${listener.name}:
${relevantMemories || "(none)"}

INSTRUCTIONS:
- Stay in character. Speak naturally in 1-3 sentences.
- Your response MUST be a single JSON object with exactly these fields:
{
  "speech": "what you say out loud",
  "emotion_delta": { "anger": 0, "trust": 0, "fear": 0, "joy": 0 },
  "relationship_delta": 0,
  "intent": "brief description of your goal in saying this",
  "conversation_end": false
}

RULES FOR DELTAS:
- emotion_delta values range from -0.2 to +0.2 (small shifts per turn)
- relationship_delta ranges from -0.1 to +0.1
- Set conversation_end to true only if you want to end the conversation
- Output ONLY the JSON object. No markdown, no code fences, no extra text.`;
}

export function buildConversationMessages(
  speaker: NPC,
  listener: NPC,
  session: ConversationSession
): ChatMessage[] {
  const msgs: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(speaker, listener) },
  ];

  for (const msg of session.messages) {
    const content = msg.rawResponse
      ? JSON.stringify(msg.rawResponse)
      : JSON.stringify({
          speech: msg.text,
          emotion_delta: { anger: 0, trust: 0, fear: 0, joy: 0 },
          relationship_delta: 0,
          intent: msg.intent || "unknown",
          conversation_end: false,
        });

    msgs.push({
      role: msg.npcId === speaker.id ? "assistant" : "user",
      content,
    });
  }

  if (session.messages.length === 0) {
    msgs.push({
      role: "user",
      content: `${listener.name} is nearby. Start a conversation. Remember: respond with ONLY a JSON object.`,
    });
  }

  return msgs;
}

function relationshipLabel(value: number): string {
  if (value > 0.5) return "close friend";
  if (value > 0.2) return "friendly acquaintance";
  if (value > -0.2) return "neutral";
  if (value > -0.5) return "somewhat tense";
  return "hostile";
}

function describeEmotions(state: EmotionalState): string {
  const parts: string[] = [];
  if (state.joy > 0.6) parts.push("happy");
  if (state.anger > 0.4) parts.push("irritated");
  if (state.fear > 0.4) parts.push("anxious");
  if (state.trust > 0.6) parts.push("trusting");
  if (state.trust < 0.3) parts.push("wary");
  return parts.length > 0 ? parts.join(", ") : "calm";
}
