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
}): NPC {
  return {
    ...partial,
    emotionalState: defaultEmotionalState(),
    relationships: {},
    shortTermMemory: [],
    longTermMemory: [],
    currentGoal: null,
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
  }),
];
