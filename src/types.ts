// ── Emotional State ────────────────────────────
export interface EmotionalState {
  anger: number; // 0 to 1
  trust: number; // 0 to 1
  fear: number; // 0 to 1
  joy: number; // 0 to 1
}

// ── Actions ───────────────────────────────────
export type ActionType =
  | "give_gift"
  | "mock"
  | "storm_off"
  | "embrace"
  | "threaten"
  | "conspire"
  | "spread_rumor";

export interface ActionData {
  action: ActionType;
  target_npc_id?: string;   // 3rd-party target for conspire/spread_rumor
  detail?: string;          // gift description, rumor text, conspiracy plan, etc.
}

// ── Behavioral Overrides ──────────────────────
export interface BehavioralOverride {
  mode: "seek" | "avoid";
  targetNpcId: string;
  expiresAt: number;       // Date.now() + duration
  reason: string;
}

// ── Memory ─────────────────────────────────────
export type MemoryType =
  | "conversation"
  | "observation"
  | "gossip"
  | "secret_learned"
  | "promise_made"
  | "promise_broken"
  | "inner_thought"
  | "eavesdrop"
  | "action_performed"
  | "action_received"
  | "action_witnessed"
  | "alliance"
  | "rumor_planted";

export interface MemoryEntry {
  text: string;
  importance: number; // 0 to 1
  recency: number; // 0 to 1, decays over time
  emotionalWeight: number; // 0 to 1
  involvedNpcIds: string[];
  timestamp: number; // Date.now()
  type?: MemoryType;
  aboutNpcIds?: string[]; // who this memory is ABOUT (vs who was present)
  sentiment?: number; // -1 to 1
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
  secrets: string[];
  knownSecrets: Record<string, string[]>; // npcId -> secrets learned about them
  behavioralOverride?: BehavioralOverride | null;
}

// ── Promises ─────────────────────────────────
export interface NpcPromise {
  id: string;
  promiserId: string;
  promiseeId: string;
  text: string;
  madeAt: number;
  status: "active" | "kept" | "broken";
}

// ── LLM Structured Response ───────────────────
export interface MentionedNpc {
  npc_id: string;
  sentiment: number; // -1 to 1
  what_was_said: string;
}

export interface LLMResponse {
  speech: string;
  emotion_delta: EmotionalState; // deltas, can be negative
  relationship_delta: number; // -1 to 1
  intent: string;
  conversation_end: boolean;
  mentioned_npcs?: MentionedNpc[];
  secret_revealed?: string;
  promise?: string;
  action?: ActionData;
}

// ── Conversation Types ───────────────────────
export type ConversationType =
  | "casual"
  | "confrontation"
  | "reconciliation"
  | "confession"
  | "alliance_forming"
  | "gossip_session";

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
export type ActivityType = "thought" | "gossip" | "eavesdrop" | "dm" | "action";

export interface ActivityEvent {
  timestamp: Date;
  text: string;
  activityType?: ActivityType;
  npcId?: string; // for styling (e.g., thought color)
}

// ── Bubbles ─────────────────────────────────────
export interface BubbleData {
  npcId: string;
  text: string;
  type: "speech" | "thought" | "action";
  startedAt: number;
  completedAt?: number;
}

// ── World / Spatial ─────────────────────────────

export interface Position {
  x: number;
  y: number;
}

export type WaypointMood =
  | "social"
  | "reflective"
  | "intimate"
  | "gathering"
  | "mysterious";

export interface Waypoint {
  id: string;
  name: string;
  position: Position;
  mood?: WaypointMood;
  description?: string;
}

export interface NpcSpatialState {
  npcId: string;
  position: Position;
  previousPosition: Position;
  lastTickTime: number;
  destination: Waypoint | null;
  idleTicksRemaining: number;
  frozen: boolean;
}

export interface WorldSnapshot {
  npcs: ReadonlyArray<Readonly<NpcSpatialState>>;
  waypoints: ReadonlyArray<Readonly<Waypoint>>;
  tickIntervalMs: number;
}
