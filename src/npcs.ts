import type { NPC, EmotionalState } from "./types";

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
];

const RANDOM_DESIRES = [
  "find belonging", "prove themselves", "protect someone dear",
  "uncover a hidden truth", "leave a legacy", "escape the past",
  "earn respect", "find inner peace", "experience adventure",
  "understand human nature", "create something beautiful", "right a wrong",
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
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], min: number, max: number): T[] {
  const n = min + Math.floor(Math.random() * (max - min + 1));
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
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
  const secrets = Math.random() < 0.3 ? [pick(RANDOM_SECRETS)] : [];

  return createNpc({ id, name, avatar, color, personalityTraits, coreDesires, secrets });
}

function defaultEmotionalState(): EmotionalState {
  return { anger: 0, trust: 0.5, fear: 0, joy: 0.5 };
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
    emotionalState: { anger: 0.6, trust: 0.2, joy: 0.3 },
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
    emotionalState: { anger: 0.1, trust: 0.3, fear: 0.2, joy: 0.6 },
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
    emotionalState: { anger: 0.2, trust: 0.15, fear: 0.7, joy: 0.1 },
    secrets: ["I once saw something I wasn't supposed to and I'm terrified someone will find out"],
  }),
];
