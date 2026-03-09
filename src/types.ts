// ── Emotional State ────────────────────────────
export interface EmotionalState {
  anger: number; // 0 to 1
  trust: number; // 0 to 1
  fear: number; // 0 to 1
  joy: number; // 0 to 1
  sadness: number; // 0 to 1
  curiosity: number; // 0 to 1
  disgust: number; // 0 to 1
  guilt: number; // 0 to 1
}

// ── Relationship ──────────────────────────────
export interface RelationshipState {
  regard: number; // -1 to 1 (general like/dislike)
  affection: number; // 0 to 1 (romantic attraction)
  respect: number; // 0 to 1 (admiration for competence/character)
  trust: number; // 0 to 1 (per-relationship trust, separate from emotional trust axis)
  fear: number; // 0 to 1 (intimidation, power imbalance)
  debt: number; // -1 to 1 (social obligation; positive = I owe them)
  familiarity: number; // 0 to 1 (how well they know each other)
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

// ── Inventory ─────────────────────────────────
export type ItemCategory = "food" | "herb" | "fish" | "trinket" | "book" | "craft";

export interface InventoryItem {
  id: string;
  label: string;
  category: ItemCategory;
  emoji: string;
  acquiredAt: number;
  lifetimeMs: number;
}

/** Per-category item lifetimes (ms). More perishable = shorter. */
export const ITEM_LIFETIME_BY_CATEGORY: Record<ItemCategory, number> = {
  fish:    2 * 60_000,   // 2 min – very perishable
  food:    3 * 60_000,   // 3 min
  herb:    5 * 60_000,   // 5 min
  craft:   8 * 60_000,   // 8 min
  trinket: 10 * 60_000,  // 10 min
  book:    12 * 60_000,  // 12 min
};

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
  | "rumor_planted"
  | "activity";

export type MemoryCategory =
  | "social"
  | "conflict"
  | "discovery"
  | "emotional"
  | "promise"
  | "routine";

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
  category?: MemoryCategory;
  unresolved?: boolean; // flags unfinished business (e.g. pending promises)
  interpretation?: string; // NPC's subjective interpretation of this event
}

// ── NPC ────────────────────────────────────────
export interface NPC {
  id: string;
  name: string;
  avatar: string;
  color: string;
  personalityTraits: string[];
  coreDesires: string[];
  backstory?: string; // narrative paragraph — preferred over traits/desires for prompts
  emotionalState: EmotionalState;
  relationships: Record<string, RelationshipState>; // NPC id -> relationship state
  shortTermMemory: MemoryEntry[];
  longTermMemory: MemoryEntry[];
  currentGoal: string | null;
  secrets: string[];
  knownSecrets: Record<string, string[]>; // npcId -> secrets learned about them
  behavioralOverride?: BehavioralOverride | null;
  inventory: InventoryItem[];
  customVoiceId?: string;
}

// ── Promises / Plans ─────────────────────────
export interface NpcPromise {
  id: string;
  promiserId: string;
  promiseeId: string;
  text: string;
  madeAt: number;
  status: "active" | "kept" | "broken";
  resolveAtPhase?: number; // phase index when this plan should resolve
}

// ── Day Cycle ────────────────────────────────
export type DayPhase = "morning" | "afternoon" | "evening";

export interface DayCycleState {
  day: number;
  phase: DayPhase;
  phaseIndex: number;       // absolute phase counter (day * 3 + phaseOrdinal)
  ticksIntoPhase: number;
}

// ── LLM Structured Response ───────────────────
export interface MentionedNpc {
  npc_id: string;
  sentiment: number; // -1 to 1
  what_was_said: string;
}

export interface LLMResponse {
  inner_thought?: string; // private reasoning before speaking
  speech: string;
  emotion_delta: EmotionalState; // deltas, can be negative
  relationship_delta: number; // -1 to 1
  affection_delta: number; // -0.1 to 0.1
  respect_delta?: number; // -0.2 to 0.2
  trust_delta?: number; // -0.2 to 0.2 (per-relationship trust)
  fear_delta?: number; // -0.2 to 0.2
  debt_delta?: number; // -0.2 to 0.2
  justification?: string; // required when deltas are large
  intent: string;
  conversation_end: boolean;
  mentioned_npcs?: MentionedNpc[];
  secret_revealed?: string;
  promise?: string;
  action?: ActionData;
}

// ── Batch Conversation (full-conversation-in-one-shot) ──

export interface BatchTurnData {
  speaker_id: string;
  inner_thought?: string; // private reasoning before speaking
  speech: string;
  emotion_delta: EmotionalState;
  relationship_delta: number;
  affection_delta: number;
  respect_delta?: number;
  trust_delta?: number;
  fear_delta?: number;
  debt_delta?: number;
  justification?: string; // required when deltas are large
  intent: string;
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
  systemPrompt?: string;
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
export type ActivityType = "thought" | "eavesdrop" | "action" | "plan";

export interface ActivityEvent {
  timestamp: Date;
  text: string;
  activityType?: ActivityType;
  npcId?: string; // for styling (e.g., thought color)
}

// ── Floaters (floating status text) ──────────────
export type FloaterCategory = "emotion" | "relationship" | "secret" | "promise";

export interface FloaterData {
  id: string;
  npcId: string;
  text: string;
  color: string;
  category: FloaterCategory;
  spawnedAt: number;
  directionX: 1 | -1;   // drift left or right (away from conversation partner)
  delay: number;         // stagger delay in ms for simultaneous floaters
  offsetY: number;       // vertical spread offset in px
  driftScale: number;    // multiplier on drift distance (0.7 – 1.3)
}

// ── Bubbles ─────────────────────────────────────
export interface BubbleData {
  npcId: string;
  text: string;
  type: "speech" | "thought" | "action";
  startedAt: number;
  completedAt?: number;
}

// ── Waypoint Activities ─────────────────────────

export type WaypointActivityId =
  | "reading"
  | "gardening"
  | "shopping"
  | "meditating"
  | "sketching"
  | "fishing"
  | "people_watching"
  | "wishing"
  | "stargazing"
  | "foraging"
  | "training"
  | "cooking"
  | "writing"
  | "napping";

export interface ItemYield {
  chance: number;  // 0–1
  category: ItemCategory;
  items: { label: string; emoji: string }[];
}

export interface WaypointActivity {
  id: WaypointActivityId;
  label: string;
  emoji: string;
  durationTicks: [number, number]; // [min, max]
  memoryText: string;              // template with {waypoint}
  flavorTexts: string[];
  traitAffinity: string[];
  emotionEffect?: Partial<EmotionalState>;
  itemYield?: ItemYield;
}

export interface ActiveActivity {
  activityId: WaypointActivityId;
  waypointId: string;
  ticksRemaining: number;
  totalTicks: number;
  startedAt: number;
}

// ── World / Spatial ─────────────────────────────

export interface Position {
  x: number;
  y: number;
}

export interface Waypoint {
  id: string;
  name: string;
  position: Position;
  moods: string[];
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
  activeActivity: ActiveActivity | null;
}

export interface WorldSnapshot {
  npcs: ReadonlyArray<Readonly<NpcSpatialState>>;
  waypoints: ReadonlyArray<Readonly<Waypoint>>;
  tickIntervalMs: number;
}
