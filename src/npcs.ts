import type { NPC, EmotionalState } from "./types";

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
