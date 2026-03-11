import type { NPC, EmotionalState, MemoryEntry, ItemCategory } from "./types";
import type { NpcStore } from "./npc-store";
import type { MemoryService } from "./memory-service";
import { weightedPick } from "./random";

// ── Interaction Types ─────────────────────────────

export type InteractionId =
  | "offer_food"
  | "give_herb"
  | "give_trinket"
  | "share_sketch"
  | "offer_fish"
  | "challenge"
  | "comfort"
  | "cold_shoulder"
  | "share_story"
  | "ask_favor"
  | "compliment"
  | "taunt"
  | "joke"
  | "tease"
  | "vent"
  | "apologize"
  | "encourage"
  | "debate"
  | "show_off"
  | "confide"
  | "reminisce"
  | "people_watch";

export interface InteractionDef {
  id: InteractionId;
  label: string;
  emoji: string;
  /** Text template: {actor} = initiator, {target} = receiver, {loc} = waypoint */
  actorText: string;
  targetText: string;
  feedText: string;
  /** Relationship delta applied to both (positive = mutual, negative = friction) */
  relationshipDelta: [number, number]; // [actor→target, target→actor]
  emotionActor: Partial<EmotionalState>;
  emotionTarget: Partial<EmotionalState>;
  /** Memory importance for both parties */
  importance: number;
  /** If set, actor must have an item of this category (consumed on use) */
  requiresItem?: ItemCategory;
  /** Required: actor must have these traits OR emotional state */
  condition: (actor: NPC, target: NPC) => boolean;
  /** Higher = more likely when conditions met */
  weight: (actor: NPC, target: NPC) => number;
}

// ── Interaction Registry ──────────────────────────

export const INTERACTIONS: Record<InteractionId, InteractionDef> = {
  offer_food: {
    id: "offer_food",
    label: "offering food",
    emoji: "🍲",
    actorText: "offers {target} some food",
    targetText: "{actor} shared food with me",
    feedText: "{actor} offered food to {target}",
    relationshipDelta: [0.05, 0.08],
    emotionActor: { joy: 0.03 },
    emotionTarget: { joy: 0.05, trust: 0.03 },
    importance: 0.4,
    requiresItem: "food",
    condition: (actor, _target) => {
      const traits = actor.personalityTraits.map(t => t.toLowerCase());
      return traits.some(t => ["kind", "charming", "optimistic", "enthusiastic"].includes(t));
    },
    weight: (actor, target) => {
      const rel = actor.relationships[target.id]?.regard ?? 0;
      return rel > -0.2 ? 2 : 0.3;
    },
  },

  give_herb: {
    id: "give_herb",
    label: "giving herbs",
    emoji: "🌿",
    actorText: "gives {target} some herbs they found",
    targetText: "{actor} gave me some herbs",
    feedText: "{actor} gave herbs to {target}",
    relationshipDelta: [0.03, 0.06],
    emotionActor: { joy: 0.02 },
    emotionTarget: { joy: 0.03, trust: 0.02 },
    importance: 0.3,
    requiresItem: "herb",
    condition: (actor, _target) => {
      const traits = actor.personalityTraits.map(t => t.toLowerCase());
      return traits.some(t => ["curious", "kind", "optimistic"].includes(t));
    },
    weight: () => 1,
  },

  give_trinket: {
    id: "give_trinket",
    label: "giving a gift",
    emoji: "🎁",
    actorText: "gives {target} a small gift",
    targetText: "{actor} gave me a thoughtful gift",
    feedText: "{actor} gave {target} a gift",
    relationshipDelta: [0.06, 0.1],
    emotionActor: { joy: 0.04 },
    emotionTarget: { joy: 0.06, trust: 0.05 },
    importance: 0.6,
    requiresItem: "trinket",
    condition: (actor, target) => {
      const rel = actor.relationships[target.id]?.regard ?? 0;
      return rel > 0;
    },
    weight: (actor, target) => {
      const rel = actor.relationships[target.id]?.regard ?? 0;
      return rel > 0.3 ? 4 : 2;
    },
  },

  share_sketch: {
    id: "share_sketch",
    label: "sharing a drawing",
    emoji: "🎨",
    actorText: "shows {target} a drawing they made",
    targetText: "{actor} showed me a drawing they made",
    feedText: "{actor} showed {target} one of their drawings",
    relationshipDelta: [0.03, 0.06],
    emotionActor: { joy: 0.03, fear: 0.01 },
    emotionTarget: { joy: 0.04, trust: 0.02 },
    importance: 0.4,
    requiresItem: "craft",
    condition: () => true,
    weight: (actor, target) => {
      const rel = actor.relationships[target.id]?.regard ?? 0;
      return rel > -0.1 ? 2 : 0.5;
    },
  },

  offer_fish: {
    id: "offer_fish",
    label: "offering fresh fish",
    emoji: "🐟",
    actorText: "offers {target} a fish they caught",
    targetText: "{actor} gave me a fresh fish",
    feedText: "{actor} offered {target} a fresh fish",
    relationshipDelta: [0.04, 0.07],
    emotionActor: { joy: 0.02 },
    emotionTarget: { joy: 0.04, trust: 0.03 },
    importance: 0.4,
    requiresItem: "fish",
    condition: (actor, _target) => {
      const traits = actor.personalityTraits.map(t => t.toLowerCase());
      return traits.some(t => ["kind", "charming", "optimistic"].includes(t));
    },
    weight: (actor, target) => {
      const rel = actor.relationships[target.id]?.regard ?? 0;
      return rel > -0.1 ? 2 : 0.5;
    },
  },

  challenge: {
    id: "challenge",
    label: "issuing a challenge",
    emoji: "⚔️",
    actorText: "challenges {target} to a sparring match",
    targetText: "{actor} challenged me to spar",
    feedText: "{actor} challenged {target} to a sparring match",
    relationshipDelta: [0.02, 0.0],
    emotionActor: { joy: 0.03, anger: -0.02 },
    emotionTarget: { fear: 0.02, anger: 0.02 },
    importance: 0.5,
    condition: (actor, _target) => {
      const traits = actor.personalityTraits.map(t => t.toLowerCase());
      return traits.some(t => ["competitive", "aggressive", "confrontational", "confident"].includes(t));
    },
    weight: (actor, target) => {
      const rel = actor.relationships[target.id]?.regard ?? 0;
      // More likely with rivals or neutral, less with close friends
      if (rel < -0.3) return 3;
      if (rel < 0.2) return 2;
      return 0.5;
    },
  },

  comfort: {
    id: "comfort",
    label: "comforting",
    emoji: "🤝",
    actorText: "sits with {target} and offers comfort",
    targetText: "{actor} comforted me when I needed it",
    feedText: "{actor} comforted {target}",
    relationshipDelta: [0.04, 0.1],
    emotionActor: { joy: 0.02 },
    emotionTarget: { fear: -0.08, joy: 0.04, trust: 0.06 },
    importance: 0.6,
    condition: (_actor, target) => {
      return target.emotionalState.fear > 0.4 || target.emotionalState.joy < 0.2;
    },
    weight: (actor, _target) => {
      const traits = actor.personalityTraits.map(t => t.toLowerCase());
      return traits.some(t => ["kind", "empathetic", "optimistic"].includes(t)) ? 4 : 1;
    },
  },

  cold_shoulder: {
    id: "cold_shoulder",
    label: "giving the cold shoulder",
    emoji: "🧊",
    actorText: "ignores {target} pointedly",
    targetText: "{actor} gave me the cold shoulder",
    feedText: "{actor} gave {target} the cold shoulder",
    relationshipDelta: [-0.02, -0.06],
    emotionActor: { anger: -0.01 },
    emotionTarget: { joy: -0.04, trust: -0.04 },
    importance: 0.4,
    condition: (actor, target) => {
      const rel = actor.relationships[target.id]?.regard ?? 0;
      return rel < -0.2;
    },
    weight: (actor, target) => {
      const rel = actor.relationships[target.id]?.regard ?? 0;
      return Math.max(0, -rel * 4);
    },
  },

  share_story: {
    id: "share_story",
    label: "sharing a story",
    emoji: "📖",
    actorText: "tells {target} a story",
    targetText: "{actor} told me an interesting story",
    feedText: "{actor} shared a story with {target}",
    relationshipDelta: [0.02, 0.04],
    emotionActor: { joy: 0.02 },
    emotionTarget: { joy: 0.03, trust: 0.01 },
    importance: 0.3,
    condition: (actor, _target) => {
      const traits = actor.personalityTraits.map(t => t.toLowerCase());
      return traits.some(t => ["charming", "philosophical", "tangential", "enthusiastic"].includes(t));
    },
    weight: (actor, target) => {
      const rel = actor.relationships[target.id]?.regard ?? 0;
      return rel > 0 ? 2 : 0.8;
    },
  },

  ask_favor: {
    id: "ask_favor",
    label: "asking a favor",
    emoji: "🙏",
    actorText: "asks {target} for a small favor",
    targetText: "{actor} asked me for a favor",
    feedText: "{actor} asked {target} for a favor",
    relationshipDelta: [0.02, -0.01],
    emotionActor: { trust: 0.02 },
    emotionTarget: { trust: 0.01 },
    importance: 0.4,
    condition: (actor, target) => {
      const rel = actor.relationships[target.id]?.regard ?? 0;
      // Need a meaningful relationship before asking favors
      return rel > 0.15;
    },
    weight: (actor, target) => {
      const rel = actor.relationships[target.id]?.regard ?? 0;
      return Math.max(0, rel * 2);
    },
  },

  compliment: {
    id: "compliment",
    label: "giving a compliment",
    emoji: "✨",
    actorText: "compliments {target}",
    targetText: "{actor} complimented me",
    feedText: "{actor} complimented {target}",
    relationshipDelta: [0.02, 0.05],
    emotionActor: { joy: 0.01 },
    emotionTarget: { joy: 0.05, trust: 0.02 },
    importance: 0.3,
    condition: (actor, target) => {
      const rel = actor.relationships[target.id]?.regard ?? 0;
      // Require at least slightly positive relationship or positive mood
      return rel > 0.05 || actor.emotionalState.joy > 0.5;
    },
    weight: (actor, _target) => {
      const traits = actor.personalityTraits.map(t => t.toLowerCase());
      if (traits.some(t => ["flattering", "charming", "kind"].includes(t))) return 2;
      if (traits.some(t => ["two-faced", "calculating"].includes(t))) return 1.5;
      return 0.5;
    },
  },

  taunt: {
    id: "taunt",
    label: "taunting",
    emoji: "😏",
    actorText: "taunts {target}",
    targetText: "{actor} taunted me",
    feedText: "{actor} taunted {target}",
    relationshipDelta: [-0.03, -0.06],
    emotionActor: { joy: 0.02 },
    emotionTarget: { anger: 0.06, joy: -0.03 },
    importance: 0.5,
    condition: (actor, target) => {
      const traits = actor.personalityTraits.map(t => t.toLowerCase());
      const rel = actor.relationships[target.id]?.regard ?? 0;
      return (
        traits.some(t => ["sardonic", "aggressive", "confrontational", "competitive"].includes(t)) &&
        rel < 0.2
      );
    },
    weight: (actor, target) => {
      const rel = actor.relationships[target.id]?.regard ?? 0;
      return rel < -0.2 ? 3 : 1;
    },
  },

  // ── Emotion-driven interactions ──────────────────

  vent: {
    id: "vent",
    label: "venting",
    emoji: "😤",
    actorText: "vents frustrations to {target}",
    targetText: "{actor} vented to me about their troubles",
    feedText: "{actor} vented frustrations to {target}",
    relationshipDelta: [0.03, 0.01],
    emotionActor: { anger: -0.06, sadness: -0.04, trust: 0.02 },
    emotionTarget: { trust: 0.02, sadness: 0.02 },
    importance: 0.5,
    condition: (actor, target) => {
      const rel = actor.relationships[target.id]?.regard ?? 0;
      // Need to be upset AND trust the target enough
      return (actor.emotionalState.anger > 0.35 || actor.emotionalState.sadness > 0.35) && rel > 0.1;
    },
    weight: (actor, _target) => {
      return (actor.emotionalState.anger + actor.emotionalState.sadness) * 3;
    },
  },

  apologize: {
    id: "apologize",
    label: "apologizing",
    emoji: "😔",
    actorText: "apologizes to {target}",
    targetText: "{actor} apologized to me",
    feedText: "{actor} apologized to {target}",
    relationshipDelta: [0.06, 0.08],
    emotionActor: { guilt: -0.1, fear: -0.03, trust: 0.03 },
    emotionTarget: { anger: -0.05, trust: 0.04, joy: 0.02 },
    importance: 0.7,
    condition: (actor, target) => {
      const rel = actor.relationships[target.id]?.regard ?? 0;
      // Guilt-driven, directed at someone the actor has harmed (low regard from target)
      const targetRel = target.relationships[actor.id]?.regard ?? 0;
      return actor.emotionalState.guilt > 0.3 && (targetRel < 0.1 || rel < 0.1);
    },
    weight: (actor, _target) => {
      return actor.emotionalState.guilt * 5;
    },
  },

  encourage: {
    id: "encourage",
    label: "encouraging",
    emoji: "💪",
    actorText: "encourages {target} with kind words",
    targetText: "{actor} encouraged me when I was feeling low",
    feedText: "{actor} encouraged {target}",
    relationshipDelta: [0.03, 0.07],
    emotionActor: { joy: 0.02 },
    emotionTarget: { joy: 0.06, fear: -0.05, sadness: -0.04, trust: 0.03 },
    importance: 0.5,
    condition: (actor, target) => {
      const traits = actor.personalityTraits.map(t => t.toLowerCase());
      // Target must be struggling, actor should be kind-natured or at least not hostile
      const targetDown = target.emotionalState.sadness > 0.3 || target.emotionalState.fear > 0.3 || target.emotionalState.joy < 0.2;
      const actorWilling = traits.some(t => ["kind", "empathetic", "optimistic", "enthusiastic", "charming"].includes(t));
      const rel = actor.relationships[target.id]?.regard ?? 0;
      return targetDown && (actorWilling || rel > 0.2);
    },
    weight: (actor, target) => {
      // Stronger when target is really struggling
      const distress = target.emotionalState.sadness + target.emotionalState.fear;
      const traits = actor.personalityTraits.map(t => t.toLowerCase());
      const traitBoost = traits.some(t => ["kind", "empathetic"].includes(t)) ? 1.5 : 0;
      return distress * 2 + traitBoost;
    },
  },

  // ── Relationship-driven interactions ─────────────

  tease: {
    id: "tease",
    label: "teasing playfully",
    emoji: "😜",
    actorText: "teases {target} playfully",
    targetText: "{actor} teased me in a friendly way",
    feedText: "{actor} playfully teased {target}",
    relationshipDelta: [0.01, 0.02],
    emotionActor: { joy: 0.03 },
    emotionTarget: { joy: 0.02, anger: 0.01 },
    importance: 0.2,
    condition: (actor, target) => {
      const rel = actor.relationships[target.id]?.regard ?? 0;
      // Only between friends — teasing strangers is just rude
      return rel > 0.2;
    },
    weight: (actor, target) => {
      const rel = actor.relationships[target.id]?.regard ?? 0;
      const traits = actor.personalityTraits.map(t => t.toLowerCase());
      const traitBoost = traits.some(t => ["sardonic", "witty", "charming", "competitive"].includes(t)) ? 1.5 : 0;
      return rel * 2 + traitBoost;
    },
  },

  confide: {
    id: "confide",
    label: "confiding",
    emoji: "🤫",
    actorText: "confides something personal to {target}",
    targetText: "{actor} trusted me with something personal",
    feedText: "{actor} confided in {target}",
    relationshipDelta: [0.05, 0.08],
    emotionActor: { fear: 0.02, trust: 0.04, sadness: -0.02 },
    emotionTarget: { trust: 0.06, curiosity: 0.03 },
    importance: 0.7,
    condition: (actor, target) => {
      const rel = actor.relationships[target.id]?.regard ?? 0;
      // Needs high trust and actor must have secrets to share
      return rel > 0.3 && actor.secrets.length > 0;
    },
    weight: (actor, target) => {
      const rel = actor.relationships[target.id]?.regard ?? 0;
      return rel * 3;
    },
  },

  reminisce: {
    id: "reminisce",
    label: "reminiscing",
    emoji: "🌅",
    actorText: "reminisces about old times with {target}",
    targetText: "{actor} and I talked about old times",
    feedText: "{actor} reminisced with {target} about shared memories",
    relationshipDelta: [0.04, 0.04],
    emotionActor: { joy: 0.04, sadness: 0.01 },
    emotionTarget: { joy: 0.04, trust: 0.02, sadness: 0.01 },
    importance: 0.4,
    condition: (actor, target) => {
      const rel = actor.relationships[target.id]?.regard ?? 0;
      // Need established friendship AND shared memories
      const sharedMemories = actor.shortTermMemory.filter(
        m => m.involvedNpcIds.includes(target.id),
      ).length + actor.longTermMemory.filter(
        m => m.involvedNpcIds.includes(target.id),
      ).length;
      return rel > 0.25 && sharedMemories >= 2;
    },
    weight: (actor, target) => {
      const rel = actor.relationships[target.id]?.regard ?? 0;
      return rel * 2 + 1;
    },
  },

  // ── Trait-driven interactions ────────────────────

  joke: {
    id: "joke",
    label: "telling a joke",
    emoji: "😂",
    actorText: "tells {target} a joke",
    targetText: "{actor} told me a funny joke",
    feedText: "{actor} told {target} a joke",
    relationshipDelta: [0.01, 0.03],
    emotionActor: { joy: 0.03 },
    emotionTarget: { joy: 0.04, anger: -0.02, sadness: -0.02 },
    importance: 0.2,
    condition: (actor, _target) => {
      const traits = actor.personalityTraits.map(t => t.toLowerCase());
      return (
        traits.some(t => ["charming", "witty", "enthusiastic", "sardonic", "optimistic"].includes(t)) ||
        actor.emotionalState.joy > 0.5
      );
    },
    weight: (actor, _target) => {
      const traits = actor.personalityTraits.map(t => t.toLowerCase());
      if (traits.some(t => ["witty", "charming", "sardonic"].includes(t))) return 2;
      return 1;
    },
  },

  debate: {
    id: "debate",
    label: "debating",
    emoji: "🤔",
    actorText: "debates a topic with {target}",
    targetText: "{actor} and I had an interesting debate",
    feedText: "{actor} debated with {target}",
    relationshipDelta: [0.01, 0.01],
    emotionActor: { curiosity: 0.05, joy: 0.01 },
    emotionTarget: { curiosity: 0.04, anger: 0.01 },
    importance: 0.4,
    condition: (actor, target) => {
      const aTraits = actor.personalityTraits.map(t => t.toLowerCase());
      const tTraits = target.personalityTraits.map(t => t.toLowerCase());
      // At least one party must be intellectually inclined
      const actorIntellectual = aTraits.some(t =>
        ["philosophical", "curious", "analytical", "calculating", "perceptive"].includes(t),
      );
      const targetIntellectual = tTraits.some(t =>
        ["philosophical", "curious", "analytical", "calculating", "perceptive"].includes(t),
      );
      return actorIntellectual || (targetIntellectual && actor.emotionalState.curiosity > 0.3);
    },
    weight: (actor, _target) => {
      return 1 + actor.emotionalState.curiosity * 2;
    },
  },

  show_off: {
    id: "show_off",
    label: "showing off",
    emoji: "💫",
    actorText: "shows off to {target}",
    targetText: "{actor} was showing off to me",
    feedText: "{actor} showed off to {target}",
    relationshipDelta: [0.01, -0.02],
    emotionActor: { joy: 0.04 },
    emotionTarget: { curiosity: 0.02, anger: 0.02 },
    importance: 0.3,
    condition: (actor, target) => {
      const traits = actor.personalityTraits.map(t => t.toLowerCase());
      const rel = actor.relationships[target.id]?.regard ?? 0;
      // Competitive/confident types showing off to non-close people
      return (
        traits.some(t => ["competitive", "confident", "aggressive", "vain", "boisterous"].includes(t)) &&
        rel < 0.3
      );
    },
    weight: (actor, _target) => {
      const traits = actor.personalityTraits.map(t => t.toLowerCase());
      if (traits.some(t => ["vain", "competitive"].includes(t))) return 2.5;
      return 1.5;
    },
  },

  people_watch: {
    id: "people_watch",
    label: "people-watching together",
    emoji: "👀",
    actorText: "sits with {target} and watches the world go by",
    targetText: "{actor} and I sat together and watched the world go by",
    feedText: "{actor} and {target} sat together, people-watching",
    relationshipDelta: [0.02, 0.02],
    emotionActor: { joy: 0.02, curiosity: 0.02, sadness: -0.01 },
    emotionTarget: { joy: 0.02, curiosity: 0.02, trust: 0.01 },
    importance: 0.2,
    condition: (actor, target) => {
      const rel = actor.relationships[target.id]?.regard ?? 0;
      const traits = actor.personalityTraits.map(t => t.toLowerCase());
      // Quiet, observant types with at least a neutral relationship
      return rel > 0 && (
        traits.some(t => ["perceptive", "curious", "philosophical", "reserved", "quiet", "contemplative"].includes(t)) ||
        actor.emotionalState.curiosity > 0.4
      );
    },
    weight: (actor, _target) => {
      const traits = actor.personalityTraits.map(t => t.toLowerCase());
      if (traits.some(t => ["perceptive", "quiet", "reserved"].includes(t))) return 2;
      return 1;
    },
  },
};

const ALL_INTERACTIONS = Object.values(INTERACTIONS);

// ── Selection Logic ───────────────────────────────

export interface InteractionResult {
  interaction: InteractionDef;
  actorId: string;
  targetId: string;
  feedText: string;
  actorBubbleText: string;
}

/**
 * Pick an interaction for two NPCs in proximity.
 * Returns null if no interaction is appropriate.
 */
export function pickInteraction(
  actorNpc: NPC,
  targetNpc: NPC,
): InteractionResult | null {
  // Score each eligible interaction
  const eligible: { def: InteractionDef; score: number }[] = [];

  for (const def of ALL_INTERACTIONS) {
    // Check item requirement
    if (def.requiresItem) {
      const hasItem = actorNpc.inventory.some(i => i.category === def.requiresItem);
      if (!hasItem) continue;
    }
    if (!def.condition(actorNpc, targetNpc)) continue;
    const w = def.weight(actorNpc, targetNpc);
    if (w <= 0) continue;
    // Boost weight for item-based interactions (they're more special)
    const itemBoost = def.requiresItem ? 2 : 0;
    eligible.push({ def, score: w + itemBoost + Math.random() * 1.5 });
  }

  if (eligible.length === 0) return null;

  const chosen = weightedPick(eligible, e => e.score).def;

  const feedText = chosen.feedText
    .replace("{actor}", actorNpc.name)
    .replace("{target}", targetNpc.name);

  const actorBubbleText = `${chosen.emoji} ${chosen.actorText
    .replace("{target}", targetNpc.name)
    .replace("{actor}", actorNpc.name)}`;

  return {
    interaction: chosen,
    actorId: actorNpc.id,
    targetId: targetNpc.id,
    feedText,
    actorBubbleText,
  };
}

/**
 * Execute an interaction: apply effects, create memories.
 */
export function executeInteraction(
  result: InteractionResult,
  store: NpcStore,
  memory: MemoryService,
): void {
  const { interaction: def, actorId, targetId } = result;
  const actor = store.get(actorId);
  const target = store.get(targetId);
  if (!actor || !target) return;

  // Consume item if required
  let consumedItemLabel: string | null = null;
  if (def.requiresItem) {
    const items = store.getItemsByCategory(actorId, def.requiresItem);
    if (items.length > 0) {
      const item = items[0];
      consumedItemLabel = `${item.emoji} ${item.label}`;
      store.removeItem(actorId, item.id);
    }
  }

  // Relationship deltas
  store.applyRelationshipDelta(actorId, targetId, def.relationshipDelta[0]);
  store.applyRelationshipDelta(targetId, actorId, def.relationshipDelta[1]);

  // Emotion deltas
  const toEmo = (partial: Partial<EmotionalState>): EmotionalState => ({
    anger: partial.anger ?? 0,
    trust: partial.trust ?? 0,
    fear: partial.fear ?? 0,
    joy: partial.joy ?? 0,
    sadness: partial.sadness ?? 0,
    curiosity: partial.curiosity ?? 0,
    guilt: partial.guilt ?? 0,
  });
  store.applyEmotionDelta(actorId, toEmo(def.emotionActor));
  store.applyEmotionDelta(targetId, toEmo(def.emotionTarget));

  // Memories
  const now = Date.now();
  const itemSuffix = consumedItemLabel ? ` (${consumedItemLabel})` : "";
  const actorMemText = def.actorText
    .replace("{target}", target.name)
    .replace("{actor}", actor.name) + itemSuffix;
  const targetMemText = def.targetText
    .replace("{actor}", actor.name)
    .replace("{target}", target.name);

  const baseMem: Omit<MemoryEntry, "text" | "involvedNpcIds"> = {
    importance: def.importance,
    recency: 1,
    emotionalWeight: def.importance * 0.8,
    timestamp: now,
    type: "action_performed",
  };

  memory.add(actorId, {
    ...baseMem,
    text: `I ${actorMemText}.`,
    involvedNpcIds: [targetId],
    type: "action_performed",
  }, "shortTermMemory");

  memory.add(targetId, {
    ...baseMem,
    text: targetMemText + ".",
    involvedNpcIds: [actorId],
    type: "action_received",
  }, "shortTermMemory");
}
