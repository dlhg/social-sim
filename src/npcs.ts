import type { NPC, EmotionalState, InventoryItem, ItemCategory } from "./types";

export const COLOR_SWATCHES = [
  "#6ec6ff",
  "#ffb74d",
  "#e53935",
  "#ab47bc",
  "#66bb6a",
  "#ffd54f",
  "#4dd0e1",
  "#ff8a65",
  "#ef5350",
  "#7e57c2",
];

export const AVATAR_OPTIONS = [
  "😀",
  "😈",
  "🤔",
  "🦊",
  "👻",
  "🤖",
  "🎪",
  "💎",
  "🔮",
  "🧠",
  "⚡",
  "🌙",
  "🎯",
  "🗡️",
  "🦉",
  "🐍",
];

const RANDOM_NAMES = [
  "Silas", "Wren", "Cassia", "Orion", "Thane", "Lyra",
  "Jasper", "Ivy", "Ronan", "Petra", "Cedric", "Dove",
  "Sable", "Flint", "Elowen", "Caspian", "Rue", "Vesper",
  "Hadley", "Bramble", "Solene", "Caius", "Opal", "Zephyr",
];

const RANDOM_TRAITS = [
  "brooding", "playful", "stubborn", "gentle", "reckless", "meticulous",
  "dramatic", "stoic", "mischievous", "earnest", "cynical", "dreamy",
  "impulsive", "patient", "sly", "loyal", "restless", "wistful",
  "bold", "cautious", "witty", "melancholic", "fierce", "whimsical",
  "charming", "suspicious", "competitive", "philosophical", "anxious",
  "optimistic", "pessimistic", "calculating", "blunt", "perceptive",
  "confrontational", "flattering", "sardonic", "enthusiastic", "contrarian",
  "manipulative", "generous", "vindictive", "idealistic", "paranoid",
  "compassionate", "detached", "obsessive", "irreverent", "territorial",
  "self-destructive", "nurturing", "defiant", "enigmatic", "sentimental",
];

const RANDOM_DESIRES = [
  "find belonging", "prove themselves", "protect someone dear",
  "uncover a hidden truth", "leave a legacy", "escape the past",
  "earn respect", "find inner peace", "experience adventure",
  "understand human nature", "create something beautiful", "right a wrong",
  "be feared by everyone", "find true love", "amass power quietly",
  "outlive their enemies", "be remembered after death", "atone for past sins",
  "destroy something corrupt", "build something that lasts", "learn every secret in town",
  "find someone who truly understands them", "prove the world wrong",
  "live without regret", "protect the vulnerable", "escape their own reputation",
  "control the narrative", "find a worthy rival", "disappear without a trace",
];

const RANDOM_SECRETS = [
  "I once betrayed someone who trusted me completely",
  "I'm hiding from someone who wants to find me",
  "I stole something valuable and never returned it",
  "I have a forbidden talent I've never shown anyone",
  "I witnessed something terrible and said nothing",
  "I'm not who everyone thinks I am",
  "I broke a sacred promise and live with the guilt",
  "I secretly long for a life completely different from this one",
  "I caused someone's downfall and let someone else take the blame",
  "I hear voices that no one else can hear",
  "I've been planning to leave this place forever",
  "I killed someone and I'd do it again",
  "I'm in love with someone who doesn't know I exist",
  "I have a debt I can never repay",
  "I once abandoned someone who needed me most",
  "I know something about this town that could destroy it",
  "My greatest achievement was actually someone else's work",
  "I keep a trophy from every person who has wronged me",
  "I pretend to be weaker than I actually am",
  "I've been lying about where I came from",
];

const RANDOM_ITEMS: { label: string; emoji: string; category: ItemCategory }[] = [
  { label: "warm bread", emoji: "🍞", category: "food" },
  { label: "honey cake", emoji: "🍰", category: "food" },
  { label: "hearty stew", emoji: "🍲", category: "food" },
  { label: "lavender sprig", emoji: "💜", category: "herb" },
  { label: "wild mint", emoji: "🌿", category: "herb" },
  { label: "chamomile bunch", emoji: "🌼", category: "herb" },
  { label: "rosemary", emoji: "🌱", category: "herb" },
  { label: "small trout", emoji: "🐟", category: "fish" },
  { label: "silverfin", emoji: "🐠", category: "fish" },
  { label: "carved pendant", emoji: "📿", category: "trinket" },
  { label: "small mirror", emoji: "🪞", category: "trinket" },
  { label: "colorful ribbon", emoji: "🎀", category: "trinket" },
  { label: "lucky coin", emoji: "🪙", category: "trinket" },
  { label: "charcoal sketch", emoji: "🖼️", category: "craft" },
  { label: "portrait drawing", emoji: "🎨", category: "craft" },
];

export function randomizeInventory(): InventoryItem[] {
  // 40% chance of no items, otherwise 1-3 items
  if (Math.random() < 0.4) return [];
  const count = 1 + Math.floor(Math.random() * 3);
  const shuffled = [...RANDOM_ITEMS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map((item) => ({
    id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    label: item.label,
    category: item.category,
    emoji: item.emoji,
    acquiredAt: Date.now(),
  }));
}

export { RANDOM_ITEMS };

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], min: number, max: number): T[] {
  const n = min + Math.floor(Math.random() * (max - min + 1));
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

export interface RandomNpcFields {
  name: string;
  avatar: string;
  color: string;
  traits: string[];
  desires: string[];
  secrets: string[];
  inventory: InventoryItem[];
}

export function randomizeFields(existingIds: string[]): RandomNpcFields {
  const usedNames = new Set(existingIds);
  let name = pick(RANDOM_NAMES);
  if (usedNames.has(name.toLowerCase())) {
    const available = RANDOM_NAMES.filter(n => !usedNames.has(n.toLowerCase()));
    if (available.length > 0) {
      name = pick(available);
    } else {
      let suffix = 2;
      while (usedNames.has(`${name.toLowerCase()}${suffix}`)) suffix++;
      name = `${name}${suffix}`;
    }
  }

  return {
    name,
    avatar: pick(AVATAR_OPTIONS),
    color: pick(COLOR_SWATCHES),
    traits: pickN(RANDOM_TRAITS, 2, 4),
    desires: pickN(RANDOM_DESIRES, 1, 3),
    secrets: pickN(RANDOM_SECRETS, 1, 2),
    inventory: randomizeInventory(),
  };
}

export function randomizeNpc(existingIds: string[]): NPC {
  const usedNames = new Set(existingIds);
  let name = pick(RANDOM_NAMES);
  if (usedNames.has(name.toLowerCase())) {
    const available = RANDOM_NAMES.filter(n => !usedNames.has(n.toLowerCase()));
    if (available.length > 0) {
      name = pick(available);
    } else {
      let suffix = 2;
      while (usedNames.has(`${name.toLowerCase()}${suffix}`)) suffix++;
      name = `${name}${suffix}`;
    }
  }

  const id = name.toLowerCase().replace(/\s+/g, "-");
  const avatar = pick(AVATAR_OPTIONS);
  const color = pick(COLOR_SWATCHES);
  const personalityTraits = pickN(RANDOM_TRAITS, 2, 4);
  const coreDesires = pickN(RANDOM_DESIRES, 1, 3);
  const secrets = pickN(RANDOM_SECRETS, 1, 2);

  const inventory = randomizeInventory();
  return createNpc({ id, name, avatar, color, personalityTraits, coreDesires, secrets, inventory });
}

function defaultEmotionalState(): EmotionalState {
  return { anger: 0, trust: 0.5, fear: 0, joy: 0.5, sadness: 0.1, curiosity: 0.4, disgust: 0, guilt: 0 };
}

export function createNpc(partial: {
  id: string;
  name: string;
  avatar: string;
  color: string;
  personalityTraits: string[];
  coreDesires: string[];
  emotionalState?: Partial<EmotionalState>;
  secrets?: string[];
  inventory?: InventoryItem[];
}): NPC {
  return {
    ...partial,
    emotionalState: {
      ...defaultEmotionalState(),
      ...(partial.emotionalState ?? {}),
    },
    relationships: {},
    shortTermMemory: [],
    longTermMemory: [],
    currentGoal: null,
    secrets: partial.secrets ?? [],
    knownSecrets: {},
    behavioralOverride: null,
    inventory: partial.inventory ?? [],
  };
}

export const initialNpcs: NPC[] = [
  createNpc({
    id: "alice",
    name: "Alice",
    avatar: "🧑‍🔬",
    color: "#6ec6ff",
    personalityTraits: ["curious", "optimistic", "enthusiastic", "tangential"],
    coreDesires: [
      "discover unexpected connections",
      "share knowledge",
      "build friendships",
    ],
    secrets: ["I once sabotaged a colleague's experiment because I was jealous of their results"],
  }),
  createNpc({
    id: "bob",
    name: "Bob",
    avatar: "📚",
    color: "#ffb74d",
    personalityTraits: ["dry-humored", "philosophical", "sardonic", "kind"],
    coreDesires: [
      "find meaning in absurdity",
      "quiet companionship",
      "intellectual stimulation",
    ],
    secrets: ["I wrote a bestselling novel under a pseudonym and never told anyone"],
  }),
  createNpc({
    id: "victor",
    name: "Victor",
    avatar: "🎭",
    color: "#e53935",
    personalityTraits: [
      "competitive",
      "blunt",
      "contrarian",
      "intellectually aggressive",
      "confident",
    ],
    coreDesires: [
      "prove intellectual superiority",
      "expose what he sees as others' naivety",
      "win every argument",
    ],
    emotionalState: { anger: 0.6, trust: 0.2, joy: 0.3, curiosity: 0.5, disgust: 0.2 },
    secrets: [
      "I secretly admire Alice's intellect but would never admit it",
      "I was rejected from my dream university",
    ],
  }),
  createNpc({
    id: "mara",
    name: "Mara",
    avatar: "🪞",
    color: "#ab47bc",
    personalityTraits: [
      "charming",
      "calculating",
      "perceptive",
      "two-faced",
      "flattering",
    ],
    coreDesires: [
      "gain social leverage over others",
      "be seen as everyone's closest confidante",
      "subtly turn people against each other",
    ],
    emotionalState: { anger: 0.1, trust: 0.3, fear: 0.2, joy: 0.6, curiosity: 0.6 },
    secrets: [
      "I keep a journal of everyone's weaknesses",
      "My charming personality is entirely constructed — I feel empty inside",
    ],
  }),
  createNpc({
    id: "ellis",
    name: "Ellis",
    avatar: "🌀",
    color: "#66bb6a",
    personalityTraits: [
      "anxious",
      "overthinking",
      "suspicious",
      "pessimistic",
      "perceptive",
    ],
    coreDesires: [
      "uncover hidden motives",
      "prepare for the worst",
      "find someone trustworthy (but doubt everyone)",
    ],
    emotionalState: { anger: 0.2, trust: 0.15, fear: 0.7, joy: 0.1, sadness: 0.4, guilt: 0.3 },
    secrets: ["I once saw something I wasn't supposed to and I'm terrified someone will find out"],
  }),
];
