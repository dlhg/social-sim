import type { NPC, EmotionalState, FloaterCategory } from "./types";
import type { NpcStore } from "./npc-store";

// ── Interfaces ──────────────────────────────────────────

export interface ConfessionalQuestion {
  text: string;
  category: string;
}

interface QuestionTemplate {
  condition: (npc: NPC, allNpcs: NPC[], store: NpcStore) => boolean;
  generate: (npc: NPC, allNpcs: NPC[], store: NpcStore) => string;
  category: string;
}

export interface ConfessionalInfluenceResult {
  emotionDeltas: { npcId: string; delta: Partial<EmotionalState> }[];
  relationshipDeltas: {
    npcId: string;
    targetId: string;
    delta: number;
    extras?: Record<string, number>;
  }[];
  floaters: { npcId: string; text: string; color: string; category: FloaterCategory }[];
}

// ── Helpers ─────────────────────────────────────────────

function npcName(id: string, allNpcs: NPC[]): string {
  return allNpcs.find((n) => n.id === id)?.name ?? id;
}

/** Find the NPC with the highest regard from this NPC's relationships. */
function highestRegardTarget(npc: NPC, allNpcs: NPC[]): { id: string; name: string; regard: number } | null {
  let best: { id: string; regard: number } | null = null;
  for (const [id, rel] of Object.entries(npc.relationships)) {
    if (!best || rel.regard > best.regard) {
      best = { id, regard: rel.regard };
    }
  }
  if (!best) return null;
  return { ...best, name: npcName(best.id, allNpcs) };
}

/** Find any NPC this NPC has low regard or low trust toward. */
function lowTrustTarget(npc: NPC, allNpcs: NPC[]): { id: string; name: string } | null {
  for (const [id, rel] of Object.entries(npc.relationships)) {
    if (rel.regard < -0.3 || rel.trust < 0.2) {
      return { id, name: npcName(id, allNpcs) };
    }
  }
  return null;
}

/** Check if NPC has a recent memory of the given type(s) and return involved NPC name. */
function recentMemoryInvolving(
  npc: NPC,
  types: string[],
  allNpcs: NPC[],
): { otherName: string } | null {
  const cutoff = Date.now() - 5 * 60_000; // last 5 minutes
  for (const mem of npc.shortTermMemory) {
    if (mem.timestamp >= cutoff && mem.type && types.includes(mem.type)) {
      const otherId = mem.involvedNpcIds.find((id) => id !== npc.id);
      if (otherId) return { otherName: npcName(otherId, allNpcs) };
    }
  }
  return null;
}

/** Find first NPC the subject knows a secret about. */
function knownSecretTarget(npc: NPC, allNpcs: NPC[]): { id: string; name: string } | null {
  for (const [id, secrets] of Object.entries(npc.knownSecrets)) {
    if (secrets.length > 0) {
      return { id, name: npcName(id, allNpcs) };
    }
  }
  return null;
}

// ── Question Templates ──────────────────────────────────

const TEMPLATES: QuestionTemplate[] = [
  // Recent conversation
  {
    category: "social",
    condition: (npc, allNpcs) =>
      recentMemoryInvolving(npc, ["conversation"], allNpcs) !== null,
    generate: (npc, allNpcs) => {
      const mem = recentMemoryInvolving(npc, ["conversation"], allNpcs)!;
      return `How do you feel about what happened with ${mem.otherName}?`;
    },
  },
  // Relationship extreme positive
  {
    category: "relationship",
    condition: (npc) => {
      const best = Object.values(npc.relationships).sort((a, b) => b.regard - a.regard)[0];
      return best !== undefined && best.regard > 0.4;
    },
    generate: (npc, allNpcs) => {
      const target = highestRegardTarget(npc, allNpcs)!;
      return `What do you really think about ${target.name}?`;
    },
  },
  // Relationship extreme negative
  {
    category: "relationship",
    condition: (npc, allNpcs) => lowTrustTarget(npc, allNpcs) !== null,
    generate: () => `Is there someone here you don't trust?`,
  },
  // Mood: volatile
  {
    category: "mood",
    condition: (npc) => npc.mood === "volatile",
    generate: () => `You seem on edge \u2014 what's bothering you?`,
  },
  // Mood: melancholy
  {
    category: "mood",
    condition: (npc) => npc.mood === "melancholy",
    generate: () => `You seem down \u2014 what's on your mind?`,
  },
  // Mood: paranoid
  {
    category: "mood",
    condition: (npc) => npc.mood === "paranoid",
    generate: () => `You seem worried \u2014 is something wrong?`,
  },
  // Has secret
  {
    category: "secret",
    condition: (npc) => npc.secrets.length > 0,
    generate: () => `Is there something you haven't told anyone?`,
  },
  // Low trust / avoid override
  {
    category: "social",
    condition: (npc) =>
      npc.behavioralOverride?.mode === "avoid" ||
      Object.values(npc.relationships).some((r) => r.trust < 0.2),
    generate: () => `Is there someone here you're keeping your distance from?`,
  },
  // Pending promise
  {
    category: "promise",
    condition: (npc, _allNpcs, store) =>
      store.getPromisesFor(npc.id).some((p) => p.status === "active"),
    generate: (npc, allNpcs, store) => {
      const promise = store
        .getPromisesFor(npc.id)
        .find((p) => p.status === "active" && p.promiserId === npc.id);
      if (promise) {
        const targetName = npcName(promise.promiseeId, allNpcs);
        return `Are you going to follow through on what you told ${targetName}?`;
      }
      // NPC is the promisee
      const received = store
        .getPromisesFor(npc.id)
        .find((p) => p.status === "active" && p.promiseeId === npc.id);
      if (received) {
        const promiserName = npcName(received.promiserId, allNpcs);
        return `Do you think ${promiserName} will keep their word?`;
      }
      return `Is there an agreement you're worried about?`;
    },
  },
  // Goal-related
  {
    category: "goal",
    condition: (npc) => npc.currentGoal !== null,
    generate: () => `What are you trying to accomplish here?`,
  },
  // Recent witnessed / received action
  {
    category: "action",
    condition: (npc, allNpcs) =>
      recentMemoryInvolving(npc, ["action_received", "action_witnessed"], allNpcs) !== null,
    generate: (npc, allNpcs) => {
      const mem = recentMemoryInvolving(npc, ["action_received", "action_witnessed"], allNpcs)!;
      return `I saw what happened with ${mem.otherName} \u2014 how do you feel about that?`;
    },
  },
  // Known secret about someone
  {
    category: "secret",
    condition: (npc, allNpcs) => knownSecretTarget(npc, allNpcs) !== null,
    generate: (npc, allNpcs) => {
      const target = knownSecretTarget(npc, allNpcs)!;
      return `You know something about ${target.name}, don't you?`;
    },
  },
  // Generic fallback (always true)
  {
    category: "general",
    condition: () => true,
    generate: () => `How are you feeling right now?`,
  },
];

// ── Question Generation ─────────────────────────────────

/**
 * Returns 3-4 contextually appropriate confessional questions for the given NPC.
 * Filters templates by condition, picks diverse categories, and always includes
 * at least one question (the generic fallback).
 */
export function generateConfessionalQuestions(
  npc: NPC,
  allNpcs: NPC[],
  store: NpcStore,
): ConfessionalQuestion[] {
  const matching: ConfessionalQuestion[] = [];

  for (const tpl of TEMPLATES) {
    if (tpl.condition(npc, allNpcs, store)) {
      matching.push({
        text: tpl.generate(npc, allNpcs, store),
        category: tpl.category,
      });
    }
  }

  // If somehow nothing matched (shouldn't happen due to fallback), return fallback
  if (matching.length === 0) {
    return [{ text: "How are you feeling right now?", category: "general" }];
  }

  // Pick 3-4 with category diversity: take one from each distinct category first,
  // then fill remaining slots from the rest.
  const TARGET_COUNT = 4;
  const selected: ConfessionalQuestion[] = [];
  const usedCategories = new Set<string>();

  // First pass: one per category
  for (const q of matching) {
    if (selected.length >= TARGET_COUNT) break;
    if (!usedCategories.has(q.category)) {
      selected.push(q);
      usedCategories.add(q.category);
    }
  }

  // Second pass: fill remaining slots regardless of category
  if (selected.length < 3) {
    for (const q of matching) {
      if (selected.length >= TARGET_COUNT) break;
      if (!selected.includes(q)) {
        selected.push(q);
      }
    }
  }

  return selected;
}

// ── Leading Question Influence ──────────────────────────

/**
 * Computes emotional and relationship side-effects from a confessional exchange.
 *
 * - If a specific NPC was mentioned with negative sentiment: raises anger, lowers trust.
 * - If a specific NPC was mentioned with positive sentiment: raises trust and affection.
 * - If no NPC mentioned (emotion/mood question): amplifies the NPC's dominant emotion.
 */
export function computeConfessionalInfluence(
  npc: NPC,
  mentionedNpcId: string | null,
  sentimentTowardMentioned: "positive" | "negative" | "neutral" | null,
  _store: NpcStore,
  diminishingMultiplier: number,
): ConfessionalInfluenceResult {
  const result: ConfessionalInfluenceResult = {
    emotionDeltas: [],
    relationshipDeltas: [],
    floaters: [],
  };

  const mult = diminishingMultiplier;
  if (mult <= 0) return result;

  if (mentionedNpcId && sentimentTowardMentioned === "negative") {
    // Anger toward the mentioned NPC rises, trust drops
    const angerDelta = 0.03 * mult;
    const trustDelta = -0.02 * mult;
    result.emotionDeltas.push({
      npcId: npc.id,
      delta: { anger: angerDelta },
    });
    result.relationshipDeltas.push({
      npcId: npc.id,
      targetId: mentionedNpcId,
      delta: 0,
      extras: { trust: trustDelta },
    });
    result.floaters.push({
      npcId: npc.id,
      text: "frustrated",
      color: "#e74c3c",
      category: "emotion",
    });
  } else if (mentionedNpcId && sentimentTowardMentioned === "positive") {
    // Trust and affection toward the mentioned NPC rise
    const trustDelta = 0.02 * mult;
    const affectionDelta = 0.01 * mult;
    result.relationshipDeltas.push({
      npcId: npc.id,
      targetId: mentionedNpcId,
      delta: 0,
      extras: { trust: trustDelta, affection: affectionDelta },
    });
    result.floaters.push({
      npcId: npc.id,
      text: "warmth",
      color: "#e88dd6",
      category: "relationship",
    });
  } else if (!mentionedNpcId) {
    // Amplify dominant emotion
    const emotions = npc.emotionalState;
    let dominant: keyof EmotionalState = "joy";
    let highest = -1;
    for (const key of Object.keys(emotions) as (keyof EmotionalState)[]) {
      if (emotions[key] > highest) {
        highest = emotions[key];
        dominant = key;
      }
    }
    const boost = 0.01 * mult;
    result.emotionDeltas.push({
      npcId: npc.id,
      delta: { [dominant]: boost },
    });
    result.floaters.push({
      npcId: npc.id,
      text: dominant,
      color: dominant === "joy" ? "#f1c40f" : dominant === "anger" ? "#e74c3c" : "#3498db",
      category: "emotion",
    });
  }
  // neutral sentiment toward a mentioned NPC produces no influence

  return result;
}

// ── Diminishing Returns Tracker ─────────────────────────

/**
 * Tracks how many times each NPC has been questioned in the current phase.
 * Returns a diminishing multiplier: 1.0 (first), 0.5 (second), 0.25 (third), 0 (fourth+).
 */
export class ConfessionalTracker {
  private counts: Map<string, number> = new Map();

  getMultiplier(npcId: string): number {
    const count = this.counts.get(npcId) ?? 0;
    if (count === 0) return 1.0;
    if (count === 1) return 0.5;
    if (count === 2) return 0.25;
    return 0;
  }

  recordUse(npcId: string): void {
    this.counts.set(npcId, (this.counts.get(npcId) ?? 0) + 1);
  }

  resetAll(): void {
    this.counts.clear();
  }
}
