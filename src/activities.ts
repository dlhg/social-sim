import type { NPC, WaypointActivity, WaypointActivityId, InventoryItem } from "./types";
import { ITEM_LIFETIME_BY_CATEGORY } from "./types";
import { weightedPick } from "./random";

// ── Activity Registry ───────────────────────────

export const ACTIVITIES: Record<WaypointActivityId, WaypointActivity> = {
  reading: {
    id: "reading",
    label: "reading a book",
    emoji: "📖",
    durationTicks: [15, 40],
    memoryText: "I spent some time reading at {waypoint}.",
    flavorTexts: [
      "It was a fascinating chapter.",
      "I couldn't focus — too many thoughts.",
      "The story reminded me of someone.",
      "A peaceful escape from everything.",
    ],
    traitAffinity: ["curious", "philosophical", "overthinking"],
    emotionEffect: { fear: -0.03, joy: 0.02 },
  },
  gardening: {
    id: "gardening",
    label: "tending the garden",
    emoji: "🌱",
    durationTicks: [20, 45],
    memoryText: "I spent time gardening at {waypoint}.",
    flavorTexts: [
      "It was peaceful.",
      "The soil felt grounding.",
      "I pulled weeds and let my mind wander.",
      "Something about growing things calms me.",
    ],
    traitAffinity: ["optimistic", "kind", "anxious"],
    emotionEffect: { anger: -0.03, joy: 0.03, fear: -0.02 },
  },
  shopping: {
    id: "shopping",
    label: "browsing the stalls",
    emoji: "🛒",
    durationTicks: [10, 30],
    memoryText: "I browsed the market stalls at {waypoint}.",
    flavorTexts: [
      "Nothing caught my eye today.",
      "I found something interesting.",
      "The merchants were chatty.",
      "I overheard an interesting conversation between traders.",
    ],
    traitAffinity: ["charming", "curious", "enthusiastic"],
    emotionEffect: { joy: 0.02 },
    itemYield: {
      chance: 0.5,
      category: "trinket",
      items: [
        { label: "carved pendant", emoji: "📿" },
        { label: "small mirror", emoji: "🪞" },
        { label: "colorful ribbon", emoji: "🎀" },
        { label: "lucky coin", emoji: "🪙" },
      ],
    },
  },
  meditating: {
    id: "meditating",
    label: "meditating quietly",
    emoji: "🧘",
    durationTicks: [20, 50],
    memoryText: "I meditated at {waypoint}.",
    flavorTexts: [
      "My mind finally went quiet for a moment.",
      "I couldn't stop thinking about what happened.",
      "A brief sense of clarity washed over me.",
      "Stillness doesn't come easily to me.",
    ],
    traitAffinity: ["philosophical", "anxious", "overthinking", "pessimistic"],
    emotionEffect: { anger: -0.04, fear: -0.04, joy: 0.02, trust: 0.02 },
  },
  sketching: {
    id: "sketching",
    label: "sketching in a notebook",
    emoji: "✏️",
    durationTicks: [15, 35],
    memoryText: "I sat and sketched at {waypoint}.",
    flavorTexts: [
      "I drew what I saw, and it felt honest.",
      "My sketch captured something I couldn't say in words.",
      "I doodled absent-mindedly.",
      "It wasn't good, but it felt right.",
    ],
    traitAffinity: ["curious", "perceptive", "tangential"],
    emotionEffect: { joy: 0.02, fear: -0.01 },
    itemYield: {
      chance: 0.3,
      category: "craft",
      items: [
        { label: "charcoal sketch", emoji: "🖼️" },
        { label: "portrait drawing", emoji: "🎨" },
      ],
    },
  },
  fishing: {
    id: "fishing",
    label: "fishing",
    emoji: "🎣",
    durationTicks: [25, 50],
    memoryText: "I went fishing at {waypoint}.",
    flavorTexts: [
      "Didn't catch anything, but the quiet was nice.",
      "I caught a small fish and let it go.",
      "The water was calming.",
      "Patience isn't my strong suit, but I tried.",
    ],
    traitAffinity: ["philosophical", "kind", "sardonic"],
    emotionEffect: { anger: -0.02, fear: -0.02, joy: 0.01 },
    itemYield: {
      chance: 0.4,
      category: "fish",
      items: [
        { label: "small trout", emoji: "🐟" },
        { label: "silverfin", emoji: "🐠" },
        { label: "pond bass", emoji: "🐟" },
      ],
    },
  },
  people_watching: {
    id: "people_watching",
    label: "watching people go by",
    emoji: "👀",
    durationTicks: [10, 25],
    memoryText: "I sat and watched people at {waypoint}.",
    flavorTexts: [
      "Everyone seems to have somewhere to be.",
      "I noticed things others miss.",
      "People are strange. Myself included.",
      "I wondered what they're all hiding.",
    ],
    traitAffinity: ["perceptive", "suspicious", "calculating", "two-faced"],
    emotionEffect: { trust: -0.01 },
  },
  wishing: {
    id: "wishing",
    label: "making a wish at the well",
    emoji: "✨",
    durationTicks: [8, 15],
    memoryText: "I made a wish at {waypoint}.",
    flavorTexts: [
      "I wished for something I'll never say out loud.",
      "I don't believe in wishes, but I made one anyway.",
      "The water swallowed my coin and my hope.",
      "Maybe this time it'll come true.",
    ],
    traitAffinity: ["optimistic", "anxious", "pessimistic"],
    emotionEffect: { joy: 0.01, fear: -0.01 },
  },
  stargazing: {
    id: "stargazing",
    label: "gazing at the sky",
    emoji: "🌙",
    durationTicks: [15, 35],
    memoryText: "I spent time stargazing at {waypoint}.",
    flavorTexts: [
      "The stars don't judge.",
      "It made me feel small, in a good way.",
      "I traced constellations and lost track of time.",
      "The sky was vast and indifferent.",
    ],
    traitAffinity: ["philosophical", "curious", "pessimistic"],
    emotionEffect: { fear: -0.02, joy: 0.02 },
  },
  foraging: {
    id: "foraging",
    label: "foraging for herbs",
    emoji: "🌿",
    durationTicks: [15, 30],
    memoryText: "I foraged for herbs at {waypoint}.",
    flavorTexts: [
      "I found some interesting plants.",
      "The earth had a rich smell today.",
      "I'm getting better at telling the useful ones apart.",
      "Nature provides, if you know where to look.",
    ],
    traitAffinity: ["curious", "enthusiastic"],
    emotionEffect: { joy: 0.02 },
    itemYield: {
      chance: 0.6,
      category: "herb",
      items: [
        { label: "lavender sprig", emoji: "💜" },
        { label: "wild mint", emoji: "🌿" },
        { label: "chamomile bunch", emoji: "🌼" },
        { label: "rosemary", emoji: "🌱" },
      ],
    },
  },
  training: {
    id: "training",
    label: "practicing combat stances",
    emoji: "⚔️",
    durationTicks: [15, 35],
    memoryText: "I practiced my combat stances at {waypoint}.",
    flavorTexts: [
      "I need to be ready for anything.",
      "Discipline keeps the chaos at bay.",
      "I imagined an opponent. I won.",
      "My body remembers even when my mind resists.",
    ],
    traitAffinity: ["competitive", "aggressive", "confrontational", "blunt", "confident"],
    emotionEffect: { anger: -0.03, fear: -0.02, joy: 0.01 },
  },
  cooking: {
    id: "cooking",
    label: "preparing a small meal",
    emoji: "🍲",
    durationTicks: [15, 30],
    memoryText: "I prepared a small meal at {waypoint}.",
    flavorTexts: [
      "Simple food, but it hit the spot.",
      "Cooking is the one thing I don't overthink.",
      "I made enough for two. Old habit.",
      "The aroma drew some curious looks.",
    ],
    traitAffinity: ["kind", "charming", "enthusiastic"],
    emotionEffect: { joy: 0.03, anger: -0.01 },
    itemYield: {
      chance: 0.7,
      category: "food",
      items: [
        { label: "warm bread", emoji: "🍞" },
        { label: "hearty stew", emoji: "🍲" },
        { label: "grilled fish", emoji: "🐟" },
        { label: "honey cake", emoji: "🍰" },
      ],
    },
  },
  writing: {
    id: "writing",
    label: "writing in a journal",
    emoji: "📝",
    durationTicks: [15, 40],
    memoryText: "I wrote in my journal at {waypoint}.",
    flavorTexts: [
      "Putting things in words helps me make sense of it all.",
      "Some thoughts are safer on paper.",
      "I wrote about someone. I won't say who.",
      "The words flowed easier than expected.",
    ],
    traitAffinity: ["philosophical", "overthinking", "perceptive", "calculating"],
    emotionEffect: { fear: -0.02, joy: 0.01 },
  },
  napping: {
    id: "napping",
    label: "napping",
    emoji: "💤",
    durationTicks: [20, 45],
    memoryText: "I took a nap at {waypoint}.",
    flavorTexts: [
      "I needed that more than I realized.",
      "I dreamed of something I can't quite remember.",
      "A brief escape from everything.",
      "Even in sleep, my mind wouldn't rest.",
    ],
    traitAffinity: ["pessimistic", "kind"],
    emotionEffect: { anger: -0.03, fear: -0.03, joy: 0.02, trust: 0.01 },
  },
};

// ── Waypoint → Available Activities ─────────────

export const WAYPOINT_ACTIVITIES: Record<string, WaypointActivityId[]> = {
  fountain:       ["people_watching", "sketching", "meditating", "napping"],
  bench:          ["reading", "writing", "sketching", "people_watching", "napping"],
  tree:           ["meditating", "reading", "napping", "stargazing"],
  garden:         ["gardening", "foraging", "meditating", "sketching"],
  market:         ["shopping", "cooking", "people_watching"],
  well:           ["wishing", "meditating", "fishing"],
  bridge:         ["fishing", "people_watching", "sketching", "stargazing"],
  chapel:         ["meditating", "writing", "napping"],
  training_yard:  ["training", "people_watching"],
  library_ruins:  ["reading", "writing", "foraging"],
  tavern_porch:   ["cooking", "people_watching", "napping"],
  hilltop:        ["stargazing", "meditating", "sketching"],
  pond:           ["fishing", "foraging", "meditating"],
};

// ── Selection Logic ─────────────────────────────

const ACTIVITY_CHANCE = 0.55;

export function shouldDoActivity(): boolean {
  return Math.random() < ACTIVITY_CHANCE;
}

export function pickActivity(
  waypointId: string,
  npc: NPC,
): WaypointActivityId | null {
  const available = WAYPOINT_ACTIVITIES[waypointId];
  if (!available || available.length === 0) return null;

  const traits = npc.personalityTraits.map(t => t.toLowerCase());
  const emo = npc.emotionalState;

  const scored = available.map(actId => {
    const act = ACTIVITIES[actId];
    let score = 1;

    // Trait affinity: +2 per matching trait
    for (const trait of act.traitAffinity) {
      if (traits.includes(trait)) score += 2;
    }

    // Emotional state influence
    if (emo.anger > 0.5 && (actId === "training" || actId === "gardening")) score += 2;
    if (emo.fear > 0.5 && (actId === "meditating" || actId === "napping" || actId === "reading")) score += 2;
    if (emo.joy > 0.6 && (actId === "sketching" || actId === "cooking" || actId === "people_watching")) score += 1.5;
    if (emo.trust < 0.3 && (actId === "writing" || actId === "meditating" || actId === "training")) score += 1.5;
    if (emo.sadness > 0.5 && (actId === "napping" || actId === "writing" || actId === "meditating")) score += 2;
    if (emo.curiosity > 0.6 && (actId === "reading" || actId === "foraging" || actId === "people_watching")) score += 1.5;
    if (emo.guilt > 0.5 && (actId === "writing" || actId === "meditating" || actId === "wishing")) score += 1.5;
    if (emo.disgust > 0.4 && (actId === "gardening" || actId === "training")) score += 1;

    // Random jitter
    score += Math.random() * 1.5;

    return { actId, score };
  });

  return weightedPick(scored, s => s.score).actId;
}

export function activityDurationTicks(actId: WaypointActivityId): number {
  const act = ACTIVITIES[actId];
  const [min, max] = act.durationTicks;
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function buildActivityMemory(
  actId: WaypointActivityId,
  waypointName: string,
): string {
  const act = ACTIVITIES[actId];
  const flavor = act.flavorTexts[Math.floor(Math.random() * act.flavorTexts.length)];
  return act.memoryText.replace("{waypoint}", waypointName) + " " + flavor;
}

/**
 * Roll for an item yield from completing an activity.
 * Returns null if no item was produced.
 */
export function rollItemYield(actId: WaypointActivityId): InventoryItem | null {
  const act = ACTIVITIES[actId];
  if (!act.itemYield) return null;
  if (Math.random() > act.itemYield.chance) return null;

  const pick = act.itemYield.items[Math.floor(Math.random() * act.itemYield.items.length)];
  const category = act.itemYield.category;
  return {
    id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    label: pick.label,
    category,
    emoji: pick.emoji,
    acquiredAt: Date.now(),
    lifetimeMs: ITEM_LIFETIME_BY_CATEGORY[category],
  };
}
