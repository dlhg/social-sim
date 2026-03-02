// ── Emotional State ────────────────────────────
export interface EmotionalState {
  anger: number; // 0 to 1
  trust: number; // 0 to 1
  fear: number; // 0 to 1
  joy: number; // 0 to 1
}

// ── Memory ─────────────────────────────────────
export interface MemoryEntry {
  text: string;
  importance: number; // 0 to 1
  recency: number; // 0 to 1, decays over time
  emotionalWeight: number; // 0 to 1
  involvedNpcIds: string[];
  timestamp: number; // Date.now()
}

// ── NPC ────────────────────────────────────────
export interface NPC {
  id: string;
  name: string;
  avatar: string;
  color: string;
  personalityTraits: string[];
  coreDesires: string[];
  emotionalState: EmotionalState;
  relationships: Record<string, number>; // NPC id -> -1 to 1
  shortTermMemory: MemoryEntry[];
  longTermMemory: MemoryEntry[];
  currentGoal: string | null;
}

// ── LLM Structured Response ───────────────────
export interface LLMResponse {
  speech: string;
  emotion_delta: EmotionalState; // deltas, can be negative
  relationship_delta: number; // -1 to 1
  intent: string;
  conversation_end: boolean;
}

// ── Conversation ──────────────────────────────
export interface ConversationMessage {
  npcId: string;
  npcName: string;
  text: string;
  intent: string;
  rawResponse?: LLMResponse;
}

export interface ConversationSession {
  id: string;
  participantIds: [string, string];
  messages: ConversationMessage[];
  turnCount: number;
  maxTurns: number;
  status: "active" | "completed" | "aborted";
  startedAt: number;
}

// ── Activity ──────────────────────────────────
export interface ActivityEvent {
  timestamp: Date;
  text: string;
}
