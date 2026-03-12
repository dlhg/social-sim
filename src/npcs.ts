import type { NPC, EmotionalState, InventoryItem, ItemCategory, NpcPromise, BetrayalRecord, ReactiveImpulse, MemoryType, MemoryCategory } from "./types";
import { ITEM_LIFETIME_BY_CATEGORY } from "./types";
import { SPRITE_NAMES } from "./sprite-system";

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
    lifetimeMs: ITEM_LIFETIME_BY_CATEGORY[item.category],
  }));
}

export { RANDOM_ITEMS };

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], min: number, max: number): T[] {
  const n = min + Math.floor(Math.random() * (max - min + 1));
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

export interface RandomNpcFields {
  name: string;
  color: string;
  spriteId: string;
  traits: string[];
  desires: string[];
  secrets: string[];
  backstory: string;
  inventory: InventoryItem[];
}

// ── Backstory generation from random components ──

const BACKSTORY_OPENERS = [
  (name: string) => `${name} has always been the kind of person who`,
  (name: string) => `People tend to underestimate ${name}, which is exactly how`,
  (name: string) => `There's a restlessness in ${name} that`,
  (name: string) => `${name} learned early on that`,
  (name: string) => `If you asked ${name} what they want, they'd tell you one thing — but the truth is`,
  (name: string) => `${name} carries themselves with`,
  (name: string) => `Most people see only one side of ${name} —`,
];

const TRAIT_CONNECTORS: Record<string, string[]> = {
  brooding: ["dwells on old wounds and unresolved questions", "finds it hard to let things go, turning memories over and over"],
  playful: ["deflects anything serious with humor, though the jokes sometimes land too close to the truth", "uses lightness as armor, rarely letting anyone see what's underneath"],
  stubborn: ["digs in harder the more they're pushed, treating compromise as a kind of defeat", "would rather be wrong and resolute than right and uncertain"],
  gentle: ["moves through the world carefully, as if afraid of leaving marks", "treats even difficult people with a patience that sometimes looks like weakness"],
  reckless: ["acts first and reckons with consequences only when they catch up", "chases intensity the way others chase safety"],
  meticulous: ["notices what others overlook, which is both a gift and a burden", "organizes the world into systems because the alternative feels like chaos"],
  dramatic: ["lives at full volume, turning minor events into grand narratives", "needs to be felt, not just heard"],
  stoic: ["keeps everything locked behind a calm surface, making it impossible to tell when they're breaking", "has learned to endure by simply refusing to react"],
  cynical: ["expects the worst from people and is rarely disappointed", "once believed in something earnestly, and the loss of that faith left a permanent edge"],
  dreamy: ["lives half in a world of their own invention, drifting between what is and what could be", "sees possibility everywhere, which makes the real world feel insufficient"],
  loyal: ["would walk through fire for the people they've chosen, which makes betrayal unforgivable", "attaches deeply and permanently, for better or worse"],
  perceptive: ["reads people like weather patterns, sensing shifts others miss entirely", "sees too much, and what they see isn't always comfortable"],
  calculating: ["weighs every interaction on a private ledger of advantage and cost", "never does anything without a reason, even when the reason is hidden"],
  compassionate: ["feels others' pain as if it were their own, which is both beautiful and unsustainable", "can't walk past suffering without trying to fix it, even when fixing it isn't their job"],
  anxious: ["lives in a state of anticipation, always bracing for the disaster that hasn't happened yet", "sees threats in shadows that others don't even notice"],
  competitive: ["measures themselves against everyone around them, turning even casual interactions into contests", "needs to win not because the prize matters but because losing is intolerable"],
  manipulative: ["learned that the easiest way to get what they want is to make others think it was their idea", "shapes situations with invisible hands, always three moves ahead"],
};

const DESIRE_BRIDGES: Record<string, string> = {
  "find belonging": "What drives them most is a hunger to belong somewhere — really belong, not just be tolerated",
  "prove themselves": "Underneath everything is a need to prove that they matter, that they're not the failure someone once told them they were",
  "protect someone dear": "They carry a fierce protectiveness for someone they love, and that loyalty shapes every decision they make",
  "uncover a hidden truth": "They're haunted by the feeling that something important is being hidden, and they won't rest until they find it",
  "escape the past": "They're running from something — a place, a person, a version of themselves — and the running has become its own kind of prison",
  "earn respect": "Respect is the currency they value above all others, and the lack of it cuts deeper than any insult",
  "find inner peace": "They're searching for a quiet they've never actually known, a silence inside that would let them finally stop fighting",
  "be feared by everyone": "They've decided that if they can't be loved, they'll settle for being feared — and fear, at least, is reliable",
  "find true love": "Somewhere beneath the armor is a desperate, almost embarrassing hope that someone will see them — really see them — and stay",
  "amass power quietly": "They gather influence the way a spider builds a web: patiently, invisibly, and with purpose",
  "control the narrative": "They need to control how others see them, because the truth — whatever it is — feels too dangerous to leave unmanaged",
};

const SECRET_SHADOWS = [
  "This secret sits at the center of their personality like a stone in a river — everything flows around it but nothing dislodges it.",
  "They've built walls around this part of themselves, and the effort of maintaining those walls has become exhausting.",
  "If anyone found out, everything would change. So they watch, and they guard, and they perform normalcy.",
  "The guilt doesn't fade. It just becomes familiar, like background noise they've learned to live with.",
  "They sometimes wonder if keeping this secret has cost them more than revealing it ever would have.",
];

export function generateBackstory(name: string, traits: string[], desires: string[], secrets: string[]): string {
  const opener = pick(BACKSTORY_OPENERS)(name);

  // Find a trait connector for the first trait that has one, or use a generic one
  const traitDesc = traits
    .map(t => TRAIT_CONNECTORS[t.toLowerCase()])
    .filter(Boolean)
    .map(options => pick(options!))
    .slice(0, 2);

  const traitPart = traitDesc.length > 0
    ? traitDesc.join(". They ")
    : `is ${traits.slice(0, 2).join(" and ")}, though these qualities pull in different directions`;

  // Find a desire bridge for the first matching desire
  const desireKey = desires.find(d => DESIRE_BRIDGES[d.toLowerCase()]);
  const desirePart = desireKey
    ? DESIRE_BRIDGES[desireKey.toLowerCase()]
    : `What they want most is to ${desires[0]?.toLowerCase() ?? "find their place"}, though they might not admit it`;

  const secretPart = secrets.length > 0 ? pick(SECRET_SHADOWS) : "";

  return `${opener} ${traitPart}. ${desirePart}. ${secretPart}`.trim();
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

  const traits = pickN(RANDOM_TRAITS, 2, 4);
  const desires = pickN(RANDOM_DESIRES, 1, 3);
  const secrets = pickN(RANDOM_SECRETS, 1, 2);

  return {
    name,
    color: pick(COLOR_SWATCHES),
    spriteId: pick([...SPRITE_NAMES]),
    traits,
    desires,
    secrets,
    backstory: generateBackstory(name, traits, desires, secrets),
    inventory: randomizeInventory(),
  };
}

const RANDOM_GOALS = [
  "find out who's been leaving strange marks on the old oak tree",
  "gather herbs for a remedy they've been working on",
  "find a quiet place to think without being interrupted",
  "figure out what that noise was last night near the bridge",
  "trade something they found for something they actually need",
  "settle a score from a conversation that's been nagging at them",
  "find someone willing to listen to a story they've been carrying",
  "explore the path beyond the eastern ridge",
  "sketch the view from the highest point before sunset",
  "track down the source of a rumor they overheard",
  "test whether someone they met recently can be trusted",
  "practice something in private before anyone sees",
  "return something they borrowed and never gave back",
  "avoid a certain person for the rest of the day",
  "find out if their suspicion about someone is justified",
];

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
  const color = pick(COLOR_SWATCHES);
  const personalityTraits = pickN(RANDOM_TRAITS, 2, 4);
  const coreDesires = pickN(RANDOM_DESIRES, 1, 3);
  const secrets = pickN(RANDOM_SECRETS, 1, 2);
  const backstory = generateBackstory(name, personalityTraits, coreDesires, secrets);
  const inventory = randomizeInventory();

  // Derive initial emotional state from personality traits
  const emotionalState = deriveEmotionsFromTraits(personalityTraits);

  const spriteId = pick([...SPRITE_NAMES]);
  const npc = createNpc({ id, name, color, spriteId, personalityTraits, coreDesires, backstory, secrets, inventory, emotionalState });

  // Give them a starting goal
  npc.currentGoal = pick(RANDOM_GOALS);

  // Derive mood from emotional state
  computeInitialMood(npc);

  return npc;
}

/** Derive a starting emotional state from personality traits */
function deriveEmotionsFromTraits(traits: string[]): Partial<EmotionalState> {
  const emo: Partial<EmotionalState> = {};
  for (const t of traits) {
    const tl = t.toLowerCase();
    if (["anxious", "paranoid", "suspicious"].includes(tl)) { emo.fear = (emo.fear ?? 0.3) + 0.25; emo.trust = Math.min(emo.trust ?? 0.3, 0.2); }
    if (["brooding", "melancholic", "wistful", "pessimistic"].includes(tl)) { emo.sadness = (emo.sadness ?? 0.1) + 0.2; emo.joy = Math.min(emo.joy ?? 0.5, 0.25); }
    if (["competitive", "confrontational", "vindictive", "territorial"].includes(tl)) { emo.anger = (emo.anger ?? 0) + 0.2; }
    if (["playful", "optimistic", "enthusiastic", "whimsical"].includes(tl)) { emo.joy = (emo.joy ?? 0.5) + 0.15; }
    if (["curious", "perceptive", "dreamy"].includes(tl)) { emo.curiosity = (emo.curiosity ?? 0.4) + 0.15; }
    if (["cynical", "calculating", "detached"].includes(tl)) { emo.trust = Math.min(emo.trust ?? 0.5, 0.2); }
    if (["loyal", "nurturing", "compassionate", "gentle"].includes(tl)) { emo.trust = (emo.trust ?? 0.5) + 0.1; }
    if (["self-destructive", "reckless"].includes(tl)) { emo.guilt = (emo.guilt ?? 0) + 0.15; }
  }
  // Clamp all values to [0, 1]
  for (const key of Object.keys(emo) as (keyof EmotionalState)[]) {
    emo[key] = Math.max(0, Math.min(1, emo[key]!));
  }
  return emo;
}

/** Compute initial mood from emotional state (mirrors NpcStore.computeAndSetMood logic) */
function computeInitialMood(npc: NPC): void {
  const s = npc.emotionalState;
  let mood: string | undefined;
  if (s.fear > 0.5 && s.trust < 0.3) mood = "paranoid";
  else if (s.anger > 0.5 && s.trust < 0.3) mood = "bitter";
  else if (s.sadness > 0.5) mood = "melancholy";
  else if (s.guilt > 0.5) mood = "guilt-ridden";
  else if (s.anger > 0.6) mood = "volatile";
  else if (s.curiosity > 0.6 && s.joy < 0.3) mood = "restless";
  else if (s.joy > 0.7) mood = "euphoric";
  if (mood) {
    npc.mood = mood;
    npc.moodSince = Date.now() - 120_000; // pre-aged so it shows in prompts immediately
  }
}

function defaultEmotionalState(): EmotionalState {
  return { anger: 0, trust: 0.5, fear: 0, joy: 0.5, sadness: 0.1, curiosity: 0.4, guilt: 0 };
}

export function createNpc(partial: {
  id: string;
  name: string;
  avatar?: string;
  color: string;
  spriteId?: string;
  personalityTraits: string[];
  coreDesires: string[];
  backstory?: string;
  emotionalState?: Partial<EmotionalState>;
  emotionalBaselines?: Partial<EmotionalState>;
  secrets?: string[];
  inventory?: InventoryItem[];
  customVoiceId?: string;
}): NPC {
  return {
    ...partial,
    avatar: partial.avatar ?? pick(AVATAR_OPTIONS),
    backstory: partial.backstory,
    emotionalState: {
      ...defaultEmotionalState(),
      ...(partial.emotionalState ?? {}),
    },
    emotionalBaselines: partial.emotionalBaselines,
    relationships: {},
    shortTermMemory: [],
    longTermMemory: [],
    currentGoal: null,
    secrets: partial.secrets ?? [],
    knownSecrets: {},
    behavioralOverride: null,
    inventory: partial.inventory ?? [],
    customVoiceId: partial.customVoiceId,
    characterArc: undefined,
    mood: undefined,
    moodSince: undefined,
  };
}

// ── Relationship constructor helper ──
function rel(
  regard: number, affection = 0, respect = 0.3, trust = 0.3,
  fear = 0, disgust = 0, debt = 0, familiarity = 0.1,
): import("./types").RelationshipState {
  return { regard, affection, respect, trust, fear, disgust, debt, familiarity };
}

// ── Seed memory helper ──
function seedMemory(
  text: string,
  involvedNpcIds: string[],
  opts: {
    importance?: number; sentiment?: number; type?: import("./types").MemoryType;
    category?: import("./types").MemoryCategory; interpretation?: string;
    aboutNpcIds?: string[]; unresolved?: boolean;
  } = {},
): import("./types").MemoryEntry {
  return {
    text,
    importance: opts.importance ?? 0.5,
    recency: 0.7,
    emotionalWeight: Math.abs(opts.sentiment ?? 0) * 0.5 + 0.2,
    involvedNpcIds,
    aboutNpcIds: opts.aboutNpcIds,
    timestamp: Date.now() - 60_000 * (10 + Math.random() * 50), // stagger into the past
    type: opts.type ?? "observation",
    category: opts.category ?? "social",
    sentiment: opts.sentiment ?? 0,
    interpretation: opts.interpretation,
    unresolved: opts.unresolved,
  };
}

export const initialNpcs: NPC[] = (() => {
  const alice = createNpc({
    id: "alice",
    name: "Alice",
    avatar: "🧑‍🔬",
    color: "#6ec6ff",
    spriteId: "Amelia",
    personalityTraits: ["curious", "optimistic", "enthusiastic", "tangential"],
    coreDesires: [
      "discover unexpected connections",
      "share knowledge",
      "understand why Victor is so hostile toward me",
    ],
    backstory: "Alice is a self-taught naturalist with an infectious sense of wonder. She sees connections everywhere — between the pattern of moss on a stone and the spiral of a snail shell, between a stranger's offhand comment and a half-remembered theorem. This relentless curiosity makes her a delightful conversationalist but an exhausting one; she'll derail any topic that catches her imagination. Beneath the enthusiasm, she carries guilt from sabotaging a colleague whose work threatened to overshadow hers — a betrayal that contradicts her self-image as someone who celebrates others' discoveries. She compensates by being aggressively generous with her own knowledge, as if sharing enough could erase what she took.",
    secrets: ["I once sabotaged a colleague's experiment because I was jealous of their results"],
    inventory: [
      { id: "item_alice_1", label: "pressed flower specimen", category: "herb", emoji: "🌸", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.herb },
      { id: "item_alice_2", label: "magnifying lens", category: "trinket", emoji: "🔍", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.trinket },
    ],
  });

  const bob = createNpc({
    id: "bob",
    name: "Bob",
    avatar: "📚",
    color: "#ffb74d",
    spriteId: "Bob",
    personalityTraits: ["dry-humored", "philosophical", "sardonic", "kind"],
    coreDesires: [
      "find meaning in absurdity",
      "quiet companionship",
      "figure out what Mara is really after",
    ],
    backstory: "Bob is the kind of person who reads Camus at breakfast and then makes a pun about it. He hides genuine warmth behind a wall of sardonic observations, not because he's afraid of connection but because he finds earnestness embarrassing — mostly his own. He wrote a novel once, under a fake name, and it became a bestseller. The success terrified him more than failure would have, so he told no one and went back to his quiet life. He craves intellectual companionship but sets the bar impossibly high, then feels lonely when people can't clear it. His kindness emerges in small, almost invisible gestures — he'll remember exactly how you take your tea but pretend he guessed.",
    secrets: ["I wrote a bestselling novel under a pseudonym and never told anyone"],
    inventory: [
      { id: "item_bob_1", label: "worn notebook", category: "book", emoji: "📓", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.book },
    ],
  });

  const victor = createNpc({
    id: "victor",
    name: "Victor",
    avatar: "🎭",
    color: "#e53935",
    spriteId: "Adam",
    personalityTraits: [
      "competitive",
      "blunt",
      "contrarian",
      "intellectually aggressive",
      "confident",
    ],
    coreDesires: [
      "prove intellectual superiority",
      "earn Alice's respect without admitting I want it",
      "find a worthy intellectual rival",
    ],
    backstory: "Victor treats every conversation like a debate he intends to win. He was rejected from the university he'd built his entire identity around, and the wound never healed — it just calcified into a need to prove, constantly, that the rejection was their mistake. He's genuinely brilliant, but his brilliance is weaponized: he finds the weak point in any argument and drives into it without mercy. What makes Victor complicated is that he secretly admires people who don't play his game. Alice's unselfconscious curiosity fascinates him precisely because he can't replicate it. He'd never admit this. Admitting it would mean admitting that intelligence isn't the only thing that matters, and that's the one argument he can't afford to lose.",
    emotionalState: { anger: 0.6, trust: 0.2, joy: 0.3, curiosity: 0.5 },
    secrets: [
      "I secretly admire Alice's intellect but would never admit it",
      "I was rejected from my dream university",
    ],
  });

  const mara = createNpc({
    id: "mara",
    name: "Mara",
    avatar: "🪞",
    color: "#ab47bc",
    spriteId: "Alex",
    personalityTraits: [
      "charming",
      "calculating",
      "perceptive",
      "two-faced",
      "flattering",
    ],
    coreDesires: [
      "gain social leverage over others",
      "learn what Ellis is hiding — they're clearly afraid of something",
      "subtly turn people against each other",
    ],
    backstory: "Mara learned early that the right words in the right ear could reshape any social landscape. She collects people's vulnerabilities the way others collect stamps — catalogued, organized, and ready to deploy. Everyone thinks they're her closest friend; no one is. She flatters with surgical precision, always calibrating exactly how much warmth will lower someone's guard. The persona is so polished that even Mara sometimes forgets where the performance ends and she begins. In rare, unguarded moments she feels a hollow ache — the suspicion that she's constructed herself so thoroughly that there's nothing real underneath. She keeps a journal of everyone's weaknesses, and the most devastating entry is her own.",
    emotionalState: { anger: 0.1, trust: 0.3, fear: 0.2, joy: 0.6, curiosity: 0.6 },
    secrets: [
      "I keep a journal of everyone's weaknesses",
      "My charming personality is entirely constructed — I feel empty inside",
    ],
    inventory: [
      { id: "item_mara_1", label: "colorful ribbon", category: "trinket", emoji: "🎀", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.trinket },
    ],
  });

  const ellis = createNpc({
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
      "find out if Bob can actually be trusted",
      "figure out whether Mara knows my secret",
    ],
    backstory: "Ellis sees threats that others miss — or imagines them so vividly that the distinction stops mattering. They witnessed something once, something they weren't supposed to see, and the fear of being found out rewired their entire personality. Now every friendly gesture carries a possible ulterior motive, every silence hides a judgment. The tragedy is that Ellis's suspicion is often perceptive: they really do notice the micro-expression that betrays a lie, the slight hesitation before a deflection. But they can't distinguish genuine danger signals from the noise of their own anxiety. They desperately want to trust someone — anyone — but every time they get close, their mind manufactures a reason to pull back. The loneliest kind of intelligence is the kind that sees too much.",
    emotionalState: { anger: 0.2, trust: 0.15, fear: 0.7, joy: 0.1, sadness: 0.4, guilt: 0.3 },
    secrets: ["I once saw something I wasn't supposed to and I'm terrified someone will find out"],
    inventory: [
      { id: "item_ellis_1", label: "lucky coin", category: "trinket", emoji: "🪙", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.trinket },
    ],
  });

  const rowan = createNpc({
    id: "rowan",
    name: "Rowan",
    avatar: "🗡️",
    color: "#ff8a65",
    spriteId: "Adam",
    personalityTraits: [
      "stoic",
      "territorial",
      "loyal",
      "blunt",
      "principled",
    ],
    coreDesires: [
      "protect the people here — even if they don't want my protection",
      "find out who Mara really is before she hurts someone",
      "earn the right to stop punishing myself",
    ],
    backstory: "Rowan used to be someone people looked up to — a guard captain whose word carried the weight of authority and trust. Then a single judgment call, made under pressure and bad orders, cost an innocent person everything: their freedom, their name, their life as they knew it. The system closed ranks to protect itself, and Rowan was told to stay silent. They stayed silent. That silence became a wound that never healed, and eventually Rowan walked away — from the title, the authority, the certainty that doing your job meant doing the right thing. Now they carry a quiet, relentless guilt that manifests as fierce protectiveness of anyone who seems vulnerable. If they can't undo what they did, they can damn well make sure it doesn't happen to anyone else. They're blunt to the point of rudeness, not from ignorance of diplomacy but from disgust with it — they've seen what careful words and pleasant smiles can hide. When Mara flatters someone, Rowan watches the way a person who's been bitten watches a dog that's showing its teeth.",
    emotionalState: { anger: 0.25, trust: 0.3, fear: 0.1, joy: 0.2, sadness: 0.3, curiosity: 0.3, guilt: 0.55 },
    emotionalBaselines: { guilt: 0.4, trust: 0.35, anger: 0.15, joy: 0.25, sadness: 0.2 },
    secrets: [
      "I let an innocent person take the blame for something they didn't do because my superior ordered me to stay silent",
      "I've been following someone for months — I think they're connected to what happened",
    ],
    inventory: [
      { id: "item_rowan_1", label: "worn leather journal", category: "book", emoji: "📖", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.book },
      { id: "item_rowan_2", label: "dried sage bundle", category: "herb", emoji: "🌿", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.herb },
    ],
  });

  const sienna = createNpc({
    id: "sienna",
    name: "Sienna",
    avatar: "⚡",
    color: "#ffd54f",
    spriteId: "Amelia",
    personalityTraits: [
      "reckless",
      "sentimental",
      "bold",
      "dramatic",
      "defiant",
    ],
    coreDesires: [
      "feel something real, even if it burns",
      "find out what Bob is hiding — quiet people fascinate me",
      "prove that honesty is braver than cleverness",
    ],
    backstory: "Sienna lives like a lit match — bright, warm, and fully aware that she's consuming herself. She was an artist once, a genuinely talented one, but perfectionism curdled into self-destruction: she burned her studio and every piece she'd ever made in a single desperate night, convinced that none of it measured up to what she could see in her head. She's been trying to outrun the emptiness ever since. She falls for people with reckless abandon — not because she's naive but because she'd rather be devastated than numb. She says what everyone else is thinking, picks the fights nobody else will pick, and cries at things others have trained themselves not to feel. This makes her simultaneously the most honest and the most exhausting person in any room. She's drawn to hidden depths: Bob's deflections fascinate her, Victor's anger intrigues her, and Ellis's fear breaks her heart. Mara's careful performance disgusts her — not because Sienna can't see the strategy, but because she finds the idea of hiding behind a constructed personality cowardly. She hasn't learned yet that caring about everyone at maximum intensity is its own kind of self-destruction.",
    emotionalState: { anger: 0.15, trust: 0.45, fear: 0.15, joy: 0.6, sadness: 0.25, curiosity: 0.55, guilt: 0.2 },
    emotionalBaselines: { joy: 0.45, sadness: 0.2, curiosity: 0.5, trust: 0.45, anger: 0.1 },
    secrets: [
      "I burned down my studio with all my work inside because none of it was good enough",
      "I'm in love with someone here and I'm terrified they'll think I'm too much",
    ],
    inventory: [
      { id: "item_sienna_1", label: "charcoal sketch", category: "craft", emoji: "🖼️", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.craft },
      { id: "item_sienna_2", label: "half-melted candle", category: "trinket", emoji: "🕯️", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.trinket },
    ],
  });

  const jasper = createNpc({
    id: "jasper",
    name: "Jasper",
    avatar: "🦊",
    color: "#4dd0e1",
    spriteId: "Alex",
    personalityTraits: [
      "charming",
      "sly",
      "witty",
      "generous",
      "conflicted",
    ],
    coreDesires: [
      "gain everyone's trust, even though I don't deserve it",
      "figure out what Rowan is really atoning for — it might be useful",
      "stop running from the people I've already hurt",
    ],
    backstory: "Jasper is the kind of person who steals your watch and then helps you look for it — and somehow you end up thanking him for the effort. He learned early that survival meant reading a room and becoming whatever the person in front of him needed: a friend, a confidant, a co-conspirator. Then he'd quietly take what he needed and move on before anyone noticed. The problem is, somewhere along the way, he started genuinely caring about the people he was using, and now he's trapped in a cycle of attachment and guilt. He's funnier than Bob, warmer than Mara, and more generous than Alice — and none of it is a lie, exactly. He really does like people. He just can't stop himself from also taking advantage of them. When Mara works a room, Jasper recognizes every move because he invented half of them — but where Mara feels empty inside, Jasper feels too much. Every friendship he's exploited haunts him, every town he's left weighs on him, and he compensates by being lavishly generous with things that don't really matter while withholding the one thing that does: the truth about who he is.",
    emotionalState: { anger: 0.05, trust: 0.35, fear: 0.2, joy: 0.55, sadness: 0.15, curiosity: 0.5, guilt: 0.3 },
    emotionalBaselines: { guilt: 0.2, joy: 0.45, curiosity: 0.45, trust: 0.35, fear: 0.15 },
    secrets: [
      "I stole something precious from the last community I lived in, and they still don't know it was me",
      "I actually care about these people, which terrifies me because caring has always been the first step toward betraying them",
    ],
    inventory: [
      { id: "item_jasper_1", label: "carved pendant", category: "trinket", emoji: "📿", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.trinket },
      { id: "item_jasper_2", label: "honey cake", category: "food", emoji: "🍰", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.food },
    ],
  });

  // ── Seed relationships ──
  // Alice: likes Bob (intellectual kinship), finds Victor abrasive, trusts Mara (hasn't seen through her), worried about Ellis
  // Appreciates Rowan's straightforwardness, kindred spirit with Sienna, charmed by Jasper's generosity
  alice.relationships = {
    bob:    rel(0.35, 0, 0.4, 0.45, 0, 0, 0.4),
    victor: rel(-0.15, 0, 0.25, 0.15, 0.15, 0, 0.35),
    mara:   rel(0.2, 0, 0.3, 0.35, 0, 0, 0.25),
    ellis:  rel(0.1, 0, 0.3, 0.3, 0, 0, 0.15),
    rowan:  rel(0.2, 0, 0.35, 0.35, 0, 0, 0.15),
    sienna: rel(0.3, 0.1, 0.25, 0.35, 0, 0, 0.2),
    jasper: rel(0.25, 0, 0.2, 0.35, 0, 0, 0.2),
  };

  // Bob: enjoys Alice's energy, suspicious of Mara, gentle with Ellis, respects Victor's mind grudgingly
  // Respects Rowan's depth, intrigued by Sienna's directness, can't quite read Jasper
  bob.relationships = {
    alice:  rel(0.3, 0, 0.45, 0.4, 0, 0, 0.4),
    victor: rel(-0.1, 0, 0.4, 0.2, 0, 0, 0.3),
    mara:   rel(-0.1, 0, 0.25, 0.15, 0, 0, 0.3),
    ellis:  rel(0.15, 0, 0.3, 0.35, 0, 0, 0.2),
    rowan:  rel(0.15, 0, 0.4, 0.3, 0, 0, 0.2),
    sienna: rel(0.1, 0.1, 0.2, 0.25, 0, 0, 0.15),
    jasper: rel(0.0, 0, 0.2, 0.15, 0, 0, 0.2),
  };

  // Victor: secretly admires Alice (high respect, hidden affection), sees Bob as sparring partner, distrusts Mara, impatient with Ellis
  // Finds Rowan's guilt tiresome but respects conviction, Sienna's emotionalism is alien to him, Jasper's agreeableness irritates
  victor.relationships = {
    alice:  rel(0.25, 0.15, 0.6, 0.2, 0, 0, 0.45),
    bob:    rel(0.05, 0, 0.4, 0.25, 0, 0, 0.3),
    mara:   rel(-0.15, 0, 0.2, 0.1, 0, 0, 0.25),
    ellis:  rel(-0.2, 0, 0.1, 0.15, 0, 0, 0.15),
    rowan:  rel(-0.15, 0, 0.25, 0.15, 0, 0, 0.2),
    sienna: rel(0.0, 0, 0.1, 0.15, 0, 0, 0.15),
    jasper: rel(-0.05, 0, 0.15, 0.2, 0, 0, 0.15),
  };

  // Mara: has studied everyone (high familiarity), targets Ellis (vulnerability), intrigued by Bob (can't read him), views Alice as easy
  // Rowan sees through her (dangerous), Sienna's honesty is threatening, Jasper is a kindred spirit or rival
  mara.relationships = {
    alice:  rel(0.2, 0, 0.3, 0.3, 0, 0, 0.5),
    bob:    rel(0.1, 0, 0.35, 0.2, 0, 0, 0.45),
    victor: rel(-0.1, 0, 0.3, 0.1, 0.2, 0, 0.5),
    ellis:  rel(0.2, 0, 0.2, 0.25, 0, 0, 0.55),
    rowan:  rel(-0.2, 0, 0.2, 0.05, 0, 0, 0.35),
    sienna: rel(-0.15, 0, 0.1, 0.1, 0, 0.1, 0.25),
    jasper: rel(0.15, 0, 0.4, 0.15, 0, 0, 0.4),
  };

  // Ellis: Bob feels safest, Mara feels wrong, Alice is overwhelming, Victor is terrifying
  // Rowan's protectiveness is comforting but authority figures are scary, Sienna is overwhelming, Jasper feels too practiced
  ellis.relationships = {
    alice:  rel(0.05, 0, 0.3, 0.25, 0, 0, 0.2),
    bob:    rel(0.15, 0, 0.35, 0.4, 0, 0, 0.25),
    victor: rel(-0.25, 0, 0.2, 0.1, 0.4, 0, 0.2),
    mara:   rel(-0.2, 0, 0.25, 0.1, 0.3, 0, 0.3),
    rowan:  rel(0.1, 0, 0.3, 0.2, 0.15, 0, 0.15),
    sienna: rel(0.05, 0, 0.2, 0.15, 0.1, 0, 0.1),
    jasper: rel(0.0, 0, 0.15, 0.15, 0.05, 0, 0.1),
  };

  // Rowan: sees through Mara, protective of Ellis, respects Bob's observation, challenged by Victor, warmed by Alice
  // Wary of Sienna's recklessness, deeply suspicious of Jasper
  rowan.relationships = {
    alice:  rel(0.2, 0, 0.35, 0.35, 0, 0, 0.15),
    bob:    rel(0.15, 0, 0.4, 0.3, 0, 0, 0.2),
    victor: rel(-0.1, 0, 0.2, 0.15, 0, 0, 0.2),
    mara:   rel(-0.3, 0, 0.2, 0.05, 0, 0.25, 0.35),
    ellis:  rel(0.2, 0, 0.3, 0.3, 0, 0, 0.2),
    sienna: rel(0.1, 0, 0.15, 0.2, 0, 0, 0.1),
    jasper: rel(-0.15, 0, 0.2, 0.1, 0, 0, 0.2),
  };

  // Sienna: drawn to Bob's depth, loves Alice's warmth, intrigued by Victor's anger, disgusted by Mara's mask
  // Respects Rowan's gravity, hasn't seen through Jasper yet
  sienna.relationships = {
    alice:  rel(0.35, 0.1, 0.3, 0.4, 0, 0, 0.2),
    bob:    rel(0.3, 0.25, 0.4, 0.3, 0, 0, 0.2),
    victor: rel(0.05, 0, 0.15, 0.2, 0, 0, 0.15),
    mara:   rel(-0.25, 0, 0.15, 0.1, 0, 0.2, 0.25),
    ellis:  rel(0.2, 0, 0.25, 0.35, 0, 0, 0.15),
    rowan:  rel(0.2, 0, 0.35, 0.3, 0, 0, 0.1),
    jasper: rel(0.2, 0.1, 0.2, 0.3, 0, 0, 0.15),
  };

  // Jasper: recognizes Mara as kindred spirit, Bob can't be read (exciting), Alice's guilelessness creates guilt
  // Rowan's moral authority is threatening, Sienna's honesty draws him, Ellis's suspicion is deserved
  jasper.relationships = {
    alice:  rel(0.3, 0, 0.3, 0.3, 0, 0, 0.2),
    bob:    rel(0.2, 0, 0.35, 0.25, 0, 0, 0.2),
    victor: rel(0.05, 0, 0.2, 0.2, 0, 0, 0.15),
    mara:   rel(0.1, 0, 0.5, 0.15, 0.1, 0, 0.4),
    ellis:  rel(0.15, 0, 0.2, 0.25, 0, 0, 0.1),
    rowan:  rel(-0.05, 0, 0.3, 0.15, 0.2, 0, 0.15),
    sienna: rel(0.25, 0.15, 0.3, 0.3, 0, 0, 0.15),
  };

  // ── Seed memories ──
  alice.shortTermMemory = [
    seedMemory("Bob and I spent an hour comparing theories about migratory patterns. He made a joke about existential dread in butterflies that I'm still thinking about.", ["bob"], {
      sentiment: 0.4, category: "social", interpretation: "He's one of the few people who can keep up with me and make me laugh at the same time.",
    }),
    seedMemory("Victor dismissed my theory about fungal networks in front of everyone. Called it 'charmingly naive.'", ["victor"], {
      sentiment: -0.3, category: "conflict", interpretation: "He's brilliant but cruel. I don't understand why he has to tear things down instead of building on them.",
    }),
    seedMemory("Mara complimented my pressed flower collection so specifically — she noticed the labeling system I use. Most people don't look that closely.", ["mara"], {
      sentiment: 0.2, category: "social", interpretation: "She pays attention. It felt nice to be seen, though I wonder if she's like that with everyone.",
    }),
  ];

  bob.shortTermMemory = [
    seedMemory("Alice got so excited about a rock she found that she nearly knocked over my tea. The rock did turn out to be interesting.", ["alice"], {
      sentiment: 0.3, category: "routine", interpretation: "She's exhausting in the best possible way. I envy that kind of unguarded enthusiasm.",
    }),
    seedMemory("Mara asked me three times what I've been writing lately. Each time it felt less like curiosity and more like reconnaissance.", ["mara"], {
      sentiment: -0.2, category: "social", interpretation: "She's fishing for something. I don't know what she'd do with personal information, but I don't want to find out.",
    }),
    seedMemory("Ellis sat near me in silence for twenty minutes and then apologized for 'being weird.' I told them silence is underrated.", ["ellis"], {
      sentiment: 0.2, category: "social", interpretation: "They're wound so tight. But there's something honest about someone who doesn't pretend to be fine.",
    }),
  ];

  victor.shortTermMemory = [
    seedMemory("Alice made a point about symbiotic relationships in ecosystems that I couldn't counter. I changed the subject.", ["alice"], {
      sentiment: -0.1, category: "conflict", interpretation: "She stumbles onto insights that I have to work for. It's infuriating. It's also fascinating.",
    }),
    seedMemory("Bob and I argued about whether free will is an illusion. He conceded nothing but bought me a drink afterward. Grudging respect.", ["bob"], {
      sentiment: 0.1, category: "social", interpretation: "He won't fight dirty, which limits him. But he's sharper than he lets on.",
    }),
    seedMemory("Mara told me I was 'the most honest person she knows.' That's either a compliment or a trap.", ["mara"], {
      sentiment: -0.15, category: "social", interpretation: "No one is that flattering without an agenda. I need to watch what I say around her.",
    }),
  ];

  mara.shortTermMemory = [
    seedMemory("Ellis flinched when I mentioned the old mill. They tried to cover it but I saw it. Something happened there.", ["ellis"], {
      sentiment: 0.1, category: "discovery", interpretation: "Whatever Ellis is hiding, it's connected to the old mill. If I can find out what it is, they'll need me to keep it quiet.",
    }),
    seedMemory("Bob deflected every personal question I asked — smoothly, almost elegantly. He's hiding something but I can't tell what.", ["bob"], {
      sentiment: -0.1, category: "social", interpretation: "He's the hardest one to read. That makes him either the least useful or the most dangerous.",
      unresolved: true,
    }),
    seedMemory("Alice told me about her old colleague without any prompting. She carries guilt she doesn't even realize she's showing.", ["alice"], {
      sentiment: 0.15, category: "social", interpretation: "Her guilt is a lever. She overcompensates with generosity — if I ever need a favor, she won't be able to say no.",
    }),
  ];

  ellis.shortTermMemory = [
    seedMemory("Mara was so nice to me yesterday it made my skin crawl. Nobody is that warm without wanting something.", ["mara"], {
      sentiment: -0.25, category: "social", interpretation: "She knows something. Or she suspects something. Either way, every conversation with her feels like a trap.",
    }),
    seedMemory("I overheard Victor and Alice arguing near the square. Victor was louder but Alice held her ground. For a moment I envied her nerve.", ["victor", "alice"], {
      sentiment: 0, type: "eavesdrop", category: "social", interpretation: "I wish I could stand up to people like that instead of just... watching from the edges.",
    }),
    seedMemory("Bob brought me tea without asking. Didn't make a big deal of it. Didn't ask anything in return.", ["bob"], {
      sentiment: 0.3, category: "social", interpretation: "Maybe he's just kind. Maybe. I want to believe that but I've been wrong before.",
      unresolved: true,
    }),
  ];

  // ── Seed goals ──
  alice.currentGoal = "investigate the unusual moss patterns near the eastern woods";
  bob.currentGoal = "find a quiet spot to think about a new writing project";
  victor.currentGoal = "prove that Alice's fungal network theory has a fatal flaw";
  mara.currentGoal = "find out what happened at the old mill that Ellis is so afraid of";
  ellis.currentGoal = "figure out whether Mara knows what I saw";

  // ── Seed known secrets (cross-references) ──
  // Ellis overheard Victor's university rejection mentioned in passing
  ellis.knownSecrets = {
    victor: ["He was rejected from his dream university"],
  };
  // Mara has picked up on Alice's guilt (perceptive + Alice "told her about her old colleague")
  mara.knownSecrets = {
    alice: ["She sabotaged a colleague's experiment out of jealousy"],
  };
  // Bob suspects Mara keeps notes on people (sardonic observation)
  bob.knownSecrets = {
    mara: ["She keeps detailed notes about people's vulnerabilities"],
  };

  // ── Seed moods (derived from pre-set emotional states) ──
  // Ellis: fear 0.7, trust 0.15 → paranoid
  ellis.mood = "paranoid";
  ellis.moodSince = Date.now() - 180_000;
  // Victor: anger 0.6 → volatile
  victor.mood = "volatile";
  victor.moodSince = Date.now() - 120_000;

  // ── Seed character arcs ──
  alice.characterArc = "Starting to question whether her generosity is genuine or just guilt wearing a mask.";
  victor.characterArc = "Realizing that winning every argument hasn't brought the respect he craves.";
  ellis.characterArc = "Slowly learning that not every kind gesture hides a motive.";
  mara.characterArc = "Feeling the first cracks in her carefully constructed persona.";

  // ── Seed richer memory types ──
  // Give some characters inner thoughts and gossip memories
  alice.shortTermMemory.push(
    seedMemory("I keep thinking about what I did to my colleague. Would these people still like me if they knew?", ["alice"], {
      importance: 0.7, sentiment: -0.4, type: "inner_thought" as MemoryType, category: "emotional" as MemoryCategory,
      interpretation: "The guilt follows me everywhere. I try to make up for it by sharing everything, but it never feels like enough.",
    }),
  );
  bob.shortTermMemory.push(
    seedMemory("I heard Mara praising Victor to his face while rolling her eyes the moment he turned away. Classic.", ["mara", "victor"], {
      importance: 0.6, sentiment: -0.2, type: "eavesdrop" as MemoryType, category: "social" as MemoryCategory,
      interpretation: "She's performing for everyone. The question is what she's after.",
      aboutNpcIds: ["mara"],
    }),
  );
  mara.shortTermMemory.push(
    seedMemory("Alice mentioned sabotaging someone's work once — she tried to pass it off casually but her hands were shaking.", ["alice"], {
      importance: 0.8, sentiment: 0.1, type: "gossip" as MemoryType, category: "discovery" as MemoryCategory,
      interpretation: "She practically handed me leverage. The guilt is eating her alive and she doesn't even realize she's confessing.",
      aboutNpcIds: ["alice"],
    }),
  );
  ellis.longTermMemory.push(
    seedMemory("I saw what happened at the old mill. I can never tell anyone. If they find out I was there...", [], {
      importance: 0.95, sentiment: -0.5, type: "inner_thought" as MemoryType, category: "emotional" as MemoryCategory,
      interpretation: "This secret is going to destroy me. But telling the truth would be worse.",
    }),
  );

  // ── Seed memories for new characters ──
  rowan.shortTermMemory = [
    seedMemory("Mara complimented my 'quiet strength' yesterday. The exact phrase my old commander used when ordering me to cover up the truth.", ["mara"], {
      sentiment: -0.35, category: "social", interpretation: "She uses warmth like a lockpick. I've seen this before. I won't make the same mistake twice.",
    }),
    seedMemory("Ellis startles at shadows the same way I did in the months after it happened. I recognize that look — the hypervigilance, the flinching.", ["ellis"], {
      sentiment: 0.15, type: "inner_thought" as MemoryType, category: "emotional" as MemoryCategory,
      interpretation: "Whatever happened to them, it left the same kind of scar. I can't fix my own but maybe I can watch their back.",
    }),
    seedMemory("Victor called my principles 'a luxury for people who haven't had to make real decisions.' He doesn't know what decisions I've made.", ["victor"], {
      sentiment: -0.2, category: "conflict", interpretation: "He fights with words the way I used to fight with authority. All that cleverness and nowhere constructive to aim it.",
    }),
    seedMemory("Alice offered me one of her pressed flowers. Said it was 'to remind me that things grow back.' I almost told her everything.", ["alice"], {
      sentiment: 0.3, category: "social", interpretation: "Her kindness is genuine. That's rare. And it makes what I'm carrying feel heavier.",
    }),
  ];

  sienna.shortTermMemory = [
    seedMemory("Bob deflected when I asked about his writing. But his eyes changed — there's something there he's protecting. I want to know what.", ["bob"], {
      sentiment: 0.2, category: "social", interpretation: "Everyone here hides behind something. Bob hides behind cleverness. But I saw the real thing for half a second.",
    }),
    seedMemory("Mara told me I was 'refreshingly honest' with a smile that didn't reach her eyes. I told her she'd be refreshing too if she ever tried it.", ["mara"], {
      sentiment: -0.3, category: "conflict", interpretation: "She's performing warmth for an audience of one and she thinks I can't tell. I can always tell.",
    }),
    seedMemory("Alice showed me her pressed flower collection. She handles them so carefully, like they're precious. I wish I could be that gentle with the things I make.", ["alice"], {
      sentiment: 0.3, category: "social", interpretation: "She creates and preserves. I create and destroy. Maybe that's why I'm drawn to her.",
    }),
    seedMemory("Everything I've made, I've destroyed. Maybe that's why I'm drawn to people who build things. Bob writes. Alice catalogues. Even Mara constructs something, even if it's a lie.", [], {
      importance: 0.7, sentiment: -0.3, type: "inner_thought" as MemoryType, category: "emotional" as MemoryCategory,
      interpretation: "I'm terrified that destruction is the only thing I'm actually good at.",
    }),
  ];

  jasper.shortTermMemory = [
    seedMemory("Mara and I locked eyes across the square. She smiled. I smiled. We both knew the other was performing. It was the most honest moment I've had in months.", ["mara"], {
      sentiment: 0.1, category: "social", interpretation: "She's running the same playbook I am. Either she's a threat or an ally, and I can't decide which is more dangerous.",
    }),
    seedMemory("Alice gave me a pressed flower 'for no reason.' For no reason. People like her make the guilt worse.", ["alice"], {
      sentiment: 0.25, category: "social", interpretation: "She's generous without calculation. It makes me feel like a fraud standing next to the real thing.",
    }),
    seedMemory("Rowan watched me the entire time I was talking to Ellis. Not threatening, just... aware. They see something. I need to be careful.", ["rowan"], {
      sentiment: -0.2, type: "observation" as MemoryType, category: "social" as MemoryCategory,
      interpretation: "Former authority. Carries themselves like someone who's arrested people before. The last thing I need is someone with instincts like that watching me.",
      aboutNpcIds: ["rowan"],
    }),
    seedMemory("I told myself this time would be different. That I'd leave before I cared. It's already too late for that.", [], {
      importance: 0.75, sentiment: -0.35, type: "inner_thought" as MemoryType, category: "emotional" as MemoryCategory,
      interpretation: "These people are getting under my skin. Every one of them. And I'm going to hurt them the way I always do.",
    }),
  ];

  // ── Additional memories for existing characters about new characters ──
  alice.shortTermMemory.push(
    seedMemory("Sienna grabbed my hands and called my moss theory 'the most beautiful thing anyone has ever said about fungus.' Nobody has ever been that excited about my work.", ["sienna"], {
      sentiment: 0.4, category: "social", interpretation: "She feels things so intensely. It's like looking in a mirror — if the mirror reflected everything turned up to eleven.",
    }),
    seedMemory("Jasper found a wildflower I've been looking for and brought it to me. He said he 'just happened to notice it.' How did he know what I was looking for?", ["jasper"], {
      sentiment: 0.15, category: "social", interpretation: "It was thoughtful. Almost too thoughtful. But maybe I'm being unfair — not everyone has an agenda.",
    }),
  );
  bob.shortTermMemory.push(
    seedMemory("Sienna asked me point-blank what I was hiding. I laughed it off. She didn't.", ["sienna"], {
      sentiment: -0.1, category: "social", interpretation: "She's relentless. Not like Mara — there's no strategy. She just genuinely wants to know. Which is somehow worse.",
    }),
    seedMemory("Rowan and I sat in silence for a long time. Comfortable silence. They don't need to perform anything. I respect that.", ["rowan"], {
      sentiment: 0.25, category: "social", interpretation: "Most people fill silence because they're afraid of what it contains. Rowan isn't afraid of anything except themselves.",
    }),
  );
  victor.shortTermMemory.push(
    seedMemory("I told Rowan their guilt was 'self-indulgent.' They looked at me like I was a child throwing a tantrum. Nobody looks at me like that.", ["rowan"], {
      sentiment: -0.25, category: "conflict", interpretation: "They didn't argue. They just looked at me. That's worse than any comeback.",
    }),
  );
  mara.shortTermMemory.push(
    seedMemory("Jasper is good. Almost as good as me. He complimented three people today and each one felt genuine. Either he's the real thing or he's running my playbook.", ["jasper"], {
      importance: 0.7, sentiment: 0.1, type: "observation" as MemoryType, category: "discovery" as MemoryCategory,
      interpretation: "He's either the most dangerous person here or the most useful. I need to figure out which before he figures me out.",
      aboutNpcIds: ["jasper"],
    }),
    seedMemory("Rowan barely speaks to me. When they do, every word lands like they've weighed it first. They're watching me.", ["rowan"], {
      sentiment: -0.2, category: "social", interpretation: "An ex-guard with a grudge against manipulators. Wonderful. I need to find their blind spot before they find mine.",
      aboutNpcIds: ["rowan"],
    }),
  );
  ellis.shortTermMemory.push(
    seedMemory("Rowan said they'd look out for me. The last person who said that turned out to be the one I needed protection from.", ["rowan"], {
      sentiment: 0.05, category: "social", interpretation: "They seem sincere. But sincerity is the easiest thing to fake. I want to believe them. I'm afraid to believe them.",
      unresolved: true,
    }),
  );

  // ── New character goals ──
  rowan.currentGoal = "figure out what Mara is really after before someone gets hurt";
  sienna.currentGoal = "get Bob to have one real conversation — no deflection, no jokes, just truth";
  jasper.currentGoal = "find out what Rowan knows about me — if anything";

  // ── New character known secrets ──
  // Rowan has independently noticed Mara's note-keeping (recognizes intelligence-gathering behavior)
  rowan.knownSecrets = {
    mara: ["She keeps detailed notes about people — I've seen her writing after conversations"],
  };
  // Jasper has also clocked Mara's journal (takes one to know one)
  jasper.knownSecrets = {
    mara: ["She keeps a journal of people's vulnerabilities — I recognize the technique"],
  };
  // Mara has picked up on Rowan's guilt about something in their past
  mara.knownSecrets = {
    ...mara.knownSecrets,
    rowan: ["They did something terrible in their past — the guilt is eating them alive"],
  };

  // ── New character moods ──
  // Rowan: guilt 0.55 → guilt-ridden
  rowan.mood = "guilt-ridden";
  rowan.moodSince = Date.now() - 180_000;

  // ── New character arcs ──
  rowan.characterArc = "Struggling with whether protection is really about the people they guard or about their own need to not fail again.";
  sienna.characterArc = "Starting to wonder whether burning bright is courage or just a prettier form of running away.";
  jasper.characterArc = "Discovering that the people he planned to use have become the people he doesn't want to lose.";

  return [alice, bob, victor, mara, ellis, rowan, sienna, jasper];
})();

// ── Seed data for the premade conflict web ──
// These are consumed by premade-storage.ts during initial seeding

/** Initial promises between preset characters */
export const PRESET_PROMISES: NpcPromise[] = [
  {
    id: "promise_preset_1",
    promiserId: "bob",
    promiseeId: "alice",
    text: "I'll take a look at those moss samples you collected and give you an honest opinion",
    madeAt: Date.now() - 300_000,
    status: "active",
  },
  {
    id: "promise_preset_2",
    promiserId: "mara",
    promiseeId: "ellis",
    text: "I won't tell anyone about your nervousness around the old mill — your secret is safe with me",
    madeAt: Date.now() - 240_000,
    status: "active",
  },
  {
    id: "promise_preset_3",
    promiserId: "jasper",
    promiseeId: "alice",
    text: "I'll help you find that rare moss specimen you mentioned — I think I know a spot",
    madeAt: Date.now() - 200_000,
    status: "active",
  },
  {
    id: "promise_preset_4",
    promiserId: "rowan",
    promiseeId: "ellis",
    text: "If anyone gives you trouble, come find me — you don't have to deal with things alone",
    madeAt: Date.now() - 260_000,
    status: "active",
  },
];

/** Initial reactive impulses for preset characters */
export const PRESET_IMPULSES: ReactiveImpulse[] = [
  {
    id: "impulse_preset_1",
    npcId: "victor",
    targetNpcId: "alice",
    reason: "Wants to challenge Alice's fungal network theory before she convinces everyone",
    conversationType: "confrontation",
    urgency: 0.6,
    expiresAt: Date.now() + 10 * 60_000,
    sourceMemoryText: "Alice made a point about symbiotic relationships that I couldn't counter",
  },
  {
    id: "impulse_preset_2",
    npcId: "mara",
    targetNpcId: "ellis",
    reason: "Wants to probe Ellis about the old mill — they flinched when she mentioned it",
    conversationType: "casual",
    urgency: 0.7,
    expiresAt: Date.now() + 10 * 60_000,
    sourceMemoryText: "Ellis flinched when I mentioned the old mill",
  },
  {
    id: "impulse_preset_3",
    npcId: "ellis",
    targetNpcId: "bob",
    reason: "Needs to find out if Bob can actually be trusted — he seems kind but Ellis can't be sure",
    conversationType: "confession",
    urgency: 0.45,
    expiresAt: Date.now() + 10 * 60_000,
    sourceMemoryText: "Bob brought me tea without asking. Didn't ask anything in return.",
  },
  {
    id: "impulse_preset_4",
    npcId: "rowan",
    targetNpcId: "mara",
    reason: "Overheard Mara using the same flattery techniques as their old commander — needs to confront her",
    conversationType: "confrontation",
    urgency: 0.55,
    expiresAt: Date.now() + 10 * 60_000,
    sourceMemoryText: "Mara complimented my 'quiet strength' — the exact phrase my old commander used",
  },
  {
    id: "impulse_preset_5",
    npcId: "sienna",
    targetNpcId: "bob",
    reason: "Wants a real conversation with Bob — no deflection, no sardonic distance, just honesty",
    conversationType: "casual",
    urgency: 0.5,
    expiresAt: Date.now() + 10 * 60_000,
    sourceMemoryText: "Bob deflected when I asked about his writing. But his eyes changed.",
  },
  {
    id: "impulse_preset_6",
    npcId: "jasper",
    targetNpcId: "mara",
    reason: "Wants to sound out Mara — figure out if she's a potential ally or a threat to his position",
    conversationType: "alliance_forming",
    urgency: 0.5,
    expiresAt: Date.now() + 10 * 60_000,
    sourceMemoryText: "Mara and I locked eyes across the square. We both knew the other was performing.",
  },
];
