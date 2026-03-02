import type { NPC, EmotionalState, ConversationSession } from "./types";
import type { ChatMessage } from "./ollama";

// ── Anti-agreeableness preamble ─────────────────

const CONFLICT_PREAMBLE = `IMPORTANT BEHAVIORAL RULES:
- Do NOT default to agreement or politeness. If your personality, emotions, or relationship suggest you would push back, argue, be cold, or be hostile — DO THAT.
- Conflict is natural. Characters with high anger should be confrontational. Characters with low trust should be suspicious. Characters who dislike someone should show it.
- Never say something like "That's a great point!" or "I understand where you're coming from" if your character would actually be annoyed, dismissive, or hostile.
- Your personality traits are not decorative. If you are "blunt" — be blunt. If you are "suspicious" — be suspicious. If you are "competitive" — try to one-up the other person.
- Emotional reactions should be proportional to your emotional state, not suppressed for politeness.`;

// ── System prompt builder ───────────────────────

export interface PromptContext {
  allNpcs?: Array<{ id: string; name: string }>;
  trajectoryContext?: string;
  locationContext?: string;
}

export function buildSystemPrompt(
  speaker: NPC,
  listener: NPC,
  turnNumber: number,
  maxTurns: number,
  ctx: PromptContext = {}
): string {
  const relationship = speaker.relationships[listener.id] ?? 0;
  const relLabel = relationshipLabel(relationship);
  const emotionSummary = describeEmotions(speaker.emotionalState);

  const emotionGuidance = emotionBehavioralGuidance(speaker.emotionalState);
  const relGuidance = relationshipBehavioralGuidance(
    relationship,
    listener.name
  );
  const allGuidance = [...emotionGuidance, ...relGuidance];

  const relevantMemories = speaker.shortTermMemory
    .filter((m) => m.involvedNpcIds.includes(listener.id))
    .sort((a, b) => b.recency * b.importance - a.recency * a.importance)
    .slice(0, 5)
    .map((m) => `- ${m.text}`)
    .join("\n");

  // Gossip memories (things heard about others — exclude gossip about current conversation partner)
  const seenGossipSubjects = new Set<string>();
  const gossipMemories = speaker.shortTermMemory
    .filter((m) => m.type === "gossip" && !m.aboutNpcIds?.includes(listener.id))
    .sort((a, b) => b.recency * b.importance - a.recency * a.importance)
    .filter((m) => {
      // Deduplicate: max 1 gossip per subject NPC
      const subjectKey = m.aboutNpcIds?.join(",") ?? m.text;
      if (seenGossipSubjects.has(subjectKey)) return false;
      seenGossipSubjects.add(subjectKey);
      return true;
    })
    .slice(0, 2)
    .map((m) => `- ${m.text}`)
    .join("\n");

  // Things this NPC has heard about the listener specifically (limit 1)
  const aboutListenerMemories = speaker.shortTermMemory
    .filter((m) => m.aboutNpcIds?.includes(listener.id) && m.type === "gossip")
    .sort((a, b) => b.recency * b.importance - a.recency * a.importance)
    .slice(0, 1)
    .map((m) => `- ${m.text}`)
    .join("\n");

  const behavioralBlock =
    allGuidance.length > 0
      ? `\nBEHAVIORAL GUIDANCE (follow these closely):\n${allGuidance.map((g) => `- ${g}`).join("\n")}`
      : "";

  // Other NPCs the speaker knows about
  const otherNpcs = (ctx.allNpcs ?? []).filter(
    (n) => n.id !== speaker.id && n.id !== listener.id
  );
  const otherNpcsBlock =
    otherNpcs.length > 0
      ? `\nOTHER PEOPLE YOU KNOW:\n${otherNpcs.map((n) => `- ${n.name} (id: "${n.id}")`).join("\n")}`
      : "";

  const gossipBlock =
    gossipMemories
      ? `\nGOSSIP YOU'VE HEARD:\n${gossipMemories}`
      : "";

  const aboutListenerBlock =
    aboutListenerMemories
      ? `\nTHINGS YOU'VE HEARD ABOUT ${listener.name.toUpperCase()}:\n${aboutListenerMemories}`
      : "";

  const trajectoryBlock = ctx.trajectoryContext
    ? `\nRELATIONSHIP TRAJECTORY: ${ctx.trajectoryContext}`
    : "";

  const locationBlock = ctx.locationContext
    ? `\nLOCATION: You are at ${ctx.locationContext}`
    : "";

  const secretsBlock =
    speaker.secrets.length > 0
      ? `\nYOUR SECRETS (only you know these — reveal ONLY if you deeply trust someone):\n${speaker.secrets.map((s) => `- ${s}`).join("\n")}\n${
          speaker.emotionalState.trust >= 0.7
            ? `Your trust is high. You MAY choose to reveal a secret to ${listener.name} by setting "secret_revealed" to the exact secret text. This is significant — don't do it casually.`
            : "Your trust is not high enough to reveal secrets right now."
        }`
      : "";

  return `You are ${speaker.name}.

PERSONALITY: ${speaker.personalityTraits.join(", ")}
CORE DESIRES: ${speaker.coreDesires.join(", ")}
CURRENT EMOTIONAL STATE: ${emotionSummary}
CURRENT GOAL: ${speaker.currentGoal ?? "none"}
${secretsBlock}

You are talking to ${listener.name}.
YOUR RELATIONSHIP WITH ${listener.name}: ${relLabel} (${relationship.toFixed(2)})
${trajectoryBlock}
${locationBlock}

RECENT MEMORIES OF ${listener.name}:
${relevantMemories || "(none)"}
${aboutListenerBlock}
${gossipBlock}
${otherNpcsBlock}

${CONFLICT_PREAMBLE}
${behavioralBlock}

CONVERSATION PROGRESS: Turn ${turnNumber + 1} of ${maxTurns}.
${turnNumber >= maxTurns - 2 ? "The conversation is wrapping up soon. Consider bringing it to a natural close." : ""}

RESPONSE FORMAT:
- Stay in character. Speak naturally in 1-3 sentences.
- NEVER repeat or paraphrase what was already said. Always move the conversation forward.
- React to what ${listener.name} actually said. Ask follow-up questions, share new thoughts, change the subject, disagree, joke — anything but echo.
- If the conversation is going in circles, take it in a completely new direction.
- You can talk about other people you know. If you mention someone not in this conversation, include them in mentioned_npcs.
- You can make promises to ${listener.name}. If you commit to something, set "promise" to what you promise.
- Your response MUST be a single JSON object with exactly these fields:
{
  "speech": "what you say out loud",
  "emotion_delta": { "anger": 0, "trust": 0, "fear": 0, "joy": 0 },
  "relationship_delta": 0,
  "intent": "brief description of your goal in saying this",
  "conversation_end": false,
  "mentioned_npcs": [],
  "secret_revealed": null,
  "promise": null
}

RULES FOR DELTAS:
- emotion_delta values range from -0.2 to +0.2 (small shifts per turn)
- relationship_delta ranges from -0.1 to +0.1
- Set conversation_end to true only if you want to end the conversation
- mentioned_npcs is optional. Only include if you talk about someone not in this conversation. Format: [{"npc_id": "id", "sentiment": 0.3, "what_was_said": "brief summary"}]
- secret_revealed: set to the exact text of a secret you're revealing, or null
- promise: set to what you promise, or null. Promises are remembered and breaking them has consequences
- Output ONLY the JSON object. No markdown, no code fences, no extra text.`;
}

// ── Conversation message builder ────────────────

export function buildConversationMessages(
  speaker: NPC,
  listener: NPC,
  session: ConversationSession,
  ctx: PromptContext = {}
): ChatMessage[] {
  const msgs: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(
        speaker,
        listener,
        session.turnCount,
        session.maxTurns,
        ctx
      ),
    },
  ];

  // Only include speech text in history (not full JSON) to keep context small
  for (const msg of session.messages) {
    if (msg.npcId === speaker.id) {
      msgs.push({
        role: "assistant",
        content: JSON.stringify({
          speech: msg.text,
          emotion_delta: { anger: 0, trust: 0, fear: 0, joy: 0 },
          relationship_delta: 0,
          intent: msg.intent || "",
          conversation_end: false,
        }),
      });
    } else {
      msgs.push({
        role: "user",
        content: `${msg.npcName} says: "${msg.text}"`,
      });
    }
  }

  if (session.messages.length === 0) {
    msgs.push({
      role: "user",
      content: `You notice ${listener.name} nearby. Start a conversation with something specific and interesting — not just a generic greeting. Respond with ONLY a JSON object.`,
    });
  }

  return msgs;
}

// ── Reflection prompt (inner monologue) ─────────

export function buildReflectionMessages(
  npc: NPC,
  otherNpcName: string,
  conversationSummary: string
): ChatMessage[] {
  const emotionSummary = describeEmotions(npc.emotionalState);
  return [
    {
      role: "system",
      content: `You are ${npc.name}. You just finished a conversation with ${otherNpcName}.

PERSONALITY: ${npc.personalityTraits.join(", ")}
CORE DESIRES: ${npc.coreDesires.join(", ")}
CURRENT EMOTIONAL STATE: ${emotionSummary}

Here's what happened in the conversation:
${conversationSummary}

Now reflect privately. What are you really thinking? What did you learn? How do you feel? Are you suspicious, hopeful, worried, amused? Be honest — no one can hear this.

Respond with ONLY a single JSON object:
{
  "thought": "your private inner thought, 1-2 sentences"
}

Output ONLY the JSON object. No markdown, no code fences, no extra text.`,
    },
  ];
}

// ── Emotion description (fine-grained) ──────────

function describeEmotion(axis: string, value: number): string | null {
  if (axis === "anger") {
    if (value >= 0.8) return "furious";
    if (value >= 0.6) return "angry";
    if (value >= 0.4) return "irritated";
    if (value >= 0.25) return "annoyed";
    return null;
  }
  if (axis === "trust") {
    if (value >= 0.8) return "deeply trusting";
    if (value >= 0.6) return "trusting";
    if (value <= 0.1) return "deeply distrustful";
    if (value <= 0.2) return "distrustful";
    if (value <= 0.35) return "wary";
    return null;
  }
  if (axis === "fear") {
    if (value >= 0.8) return "terrified";
    if (value >= 0.6) return "fearful";
    if (value >= 0.4) return "anxious";
    if (value >= 0.25) return "uneasy";
    return null;
  }
  if (axis === "joy") {
    if (value >= 0.8) return "elated";
    if (value >= 0.6) return "happy";
    if (value >= 0.4) return "content";
    if (value <= 0.1) return "miserable";
    if (value <= 0.2) return "unhappy";
    if (value <= 0.3) return "glum";
    return null;
  }
  return null;
}

function describeEmotions(state: EmotionalState): string {
  const parts: string[] = [];
  for (const [axis, value] of Object.entries(state)) {
    const label = describeEmotion(axis, value);
    if (label) parts.push(label);
  }
  return parts.length > 0 ? parts.join(", ") : "emotionally neutral";
}

// ── Emotion → behavioral guidance ───────────────

function emotionBehavioralGuidance(state: EmotionalState): string[] {
  const guidance: string[] = [];

  // Anger
  if (state.anger >= 0.7) {
    guidance.push(
      "You are seething. Be confrontational, cutting, and sharp. Do not hold back criticism. " +
        "You may raise your voice, use biting sarcasm, or directly attack what the other person says."
    );
  } else if (state.anger >= 0.4) {
    guidance.push(
      "You are irritated. Be curt, impatient, and ready to push back. " +
        "Challenge statements you disagree with. Don't smooth things over."
    );
  } else if (state.anger >= 0.25) {
    guidance.push(
      "You are mildly annoyed. Let it show through clipped responses or subtle barbs."
    );
  }

  // Trust
  if (state.trust <= 0.15) {
    guidance.push(
      "You deeply distrust this person. Be guarded, evasive, and suspicious. " +
        "Read hidden motives into what they say. Don't share personal information. " +
        "Question their intentions openly or through pointed remarks."
    );
  } else if (state.trust <= 0.3) {
    guidance.push(
      "You are wary of this person. Be cautious about what you reveal. " +
        "You suspect they may not be genuine. Deflect personal questions."
    );
  } else if (state.trust >= 0.8) {
    guidance.push(
      "You trust this person deeply. Be open and vulnerable. Share things you wouldn't tell others."
    );
  }

  // Fear
  if (state.fear >= 0.7) {
    guidance.push(
      "You are very anxious. Second-guess yourself and others. Catastrophize. " +
        "You may try to flee the conversation or become defensive and jumpy."
    );
  } else if (state.fear >= 0.4) {
    guidance.push(
      "You are on edge. Be nervous and vigilant. Interpret ambiguous statements negatively."
    );
  }

  // Joy
  if (state.joy <= 0.15) {
    guidance.push(
      "You are deeply unhappy. Be bleak, humorless, and pessimistic. " +
        "Don't pretend to enjoy things. Let your misery color everything you say."
    );
  } else if (state.joy <= 0.3) {
    guidance.push(
      "You are not in a good mood. Be subdued and downbeat. Positivity feels forced to you."
    );
  } else if (state.joy >= 0.8) {
    guidance.push(
      "You are in an excellent mood. Be warm, enthusiastic, and generous. " +
        "But if someone provokes you, the contrast with your good mood makes it hit harder."
    );
  }

  // Compound emotional states
  if (state.anger >= 0.4 && state.fear >= 0.4) {
    guidance.push(
      "You are both angry and afraid — this makes you volatile. " +
        "You might lash out defensively or make accusations born from insecurity."
    );
  }
  if (state.anger >= 0.4 && state.trust <= 0.3) {
    guidance.push(
      "You are angry AND distrustful — a dangerous combination. " +
        "You suspect this person is trying to manipulate or undermine you."
    );
  }
  if (state.fear >= 0.4 && state.trust <= 0.3) {
    guidance.push(
      "You are anxious and distrustful. You see threats everywhere. " +
        "Read between the lines of everything they say."
    );
  }

  return guidance;
}

// ── Relationship → behavioral guidance ──────────

function relationshipBehavioralGuidance(
  relationship: number,
  listenerName: string
): string[] {
  const guidance: string[] = [];

  if (relationship <= -0.6) {
    guidance.push(
      `You actively dislike ${listenerName}. Be cold, dismissive, or openly hostile. ` +
        `Do not pretend to be friendly. You may bring up past grievances or refuse to engage warmly.`
    );
  } else if (relationship <= -0.3) {
    guidance.push(
      `You have a negative opinion of ${listenerName}. Be cool, skeptical, and quick to disagree. ` +
        `Don't go out of your way to be pleasant.`
    );
  } else if (relationship <= -0.1) {
    guidance.push(
      `You are slightly wary of ${listenerName}. You haven't warmed to them. ` +
        `Be polite but distant — no warmth.`
    );
  } else if (relationship >= 0.6) {
    guidance.push(
      `You consider ${listenerName} a close friend. Be genuine, affectionate, and willing to be vulnerable. ` +
        `You can tease them in ways you wouldn't with others.`
    );
  } else if (relationship >= 0.3) {
    guidance.push(
      `You like ${listenerName}. Be friendly and engaged, but you're not deeply bonded yet.`
    );
  }

  return guidance;
}

// ── Relationship label ──────────────────────────

function relationshipLabel(value: number): string {
  if (value > 0.6) return "close friend";
  if (value > 0.3) return "friendly";
  if (value > 0.1) return "slightly positive";
  if (value > -0.1) return "neutral";
  if (value > -0.3) return "slightly negative";
  if (value > -0.6) return "tense";
  return "hostile";
}
