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

  const wren = createNpc({
    id: "wren",
    name: "Wren",
    avatar: "🦉",
    color: "#7e57c2",
    spriteId: "Bob",
    personalityTraits: [
      "patient",
      "perceptive",
      "enigmatic",
      "cautious",
      "meticulous",
    ],
    coreDesires: [
      "learn every secret in this place without anyone realizing I'm listening",
      "figure out what connects Rowan's guilt to Ellis's fear — something doesn't add up",
      "find someone worth trusting with what I know",
    ],
    backstory: "Wren learned early that the loudest person in the room is never the most powerful — the most powerful is the one nobody's watching. They've built a life around being unremarkable: the person who blends into the furniture, who's always present but never quite remembered. This isn't shyness; it's strategy. They listen with a recorder's precision, filing away inconsistencies and contradictions that others miss in the noise of their own talking. They've noticed that Mara keeps notes after conversations. They've noticed that Jasper's generosity follows a pattern. They've noticed that Ellis and Rowan flinch at the same things. The problem with seeing everything is that eventually you see something you can't unsee, and Wren is getting close to understanding something about this community that connects several people's secrets in ways none of them realize. They want to trust someone with what they're piecing together, but trust requires being seen, and being seen has always felt like being vulnerable. The last time someone truly noticed Wren, they used what they learned to dismantle Wren's entire life. So Wren watches, and waits, and tells themselves that patience is the same thing as safety.",
    emotionalState: { anger: 0.05, trust: 0.2, fear: 0.25, joy: 0.25, sadness: 0.2, curiosity: 0.7, guilt: 0.1 },
    emotionalBaselines: { curiosity: 0.6, trust: 0.25, fear: 0.15, joy: 0.35 },
    secrets: [
      "I've been piecing together a connection between several people's secrets that none of them realize exists",
      "I choose to be invisible because the last time someone really saw me, they used what they knew to destroy everything I had",
    ],
    inventory: [
      { id: "item_wren_1", label: "small notebook", category: "book", emoji: "📒", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.book },
      { id: "item_wren_2", label: "pressed leaf", category: "herb", emoji: "🍂", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.herb },
    ],
  });

  const dove = createNpc({
    id: "dove",
    name: "Dove",
    avatar: "🌙",
    color: "#ef5350",
    spriteId: "Amelia",
    personalityTraits: [
      "compassionate",
      "melancholic",
      "defiant",
      "idealistic",
      "pessimistic",
    ],
    coreDesires: [
      "find proof that kindness isn't just weakness waiting to be exploited",
      "understand why Sienna still burns when I've gone cold",
      "stop helping people who don't deserve it — and figure out why I can't",
    ],
    backstory: "Dove used to believe that if you were kind enough, patient enough, and brave enough, the world would eventually bend toward justice. They spent years proving it — mediating disputes, advocating for people who couldn't advocate for themselves, building bridges between enemies. And then they watched every bridge burn. Not all at once, but slowly: the people they helped turned on each other, the compromises they brokered collapsed into worse conflicts, and the one person they trusted most used their idealism as cover for something unforgivable. Now Dove carries a bitterness that's all the sharper for sitting on top of a compassion they can't kill. They still bring soup to sick neighbors. They still notice when someone's hurting. But every act of kindness comes with a twist of resentment — at the world for not deserving it, and at themselves for being unable to stop. Sienna's reckless passion baffles them: how can anyone still feel that much and survive? Victor's cynicism feels honest to them now in a way it never would have before. And Alice's optimism is either the most admirable or the most naive thing Dove has ever seen.",
    emotionalState: { anger: 0.2, trust: 0.2, fear: 0.1, joy: 0.2, sadness: 0.55, curiosity: 0.3, guilt: 0.25 },
    emotionalBaselines: { sadness: 0.35, trust: 0.25, joy: 0.3, anger: 0.1 },
    secrets: [
      "The person I trusted most used my advocacy work as cover to exploit the people I was trying to help",
      "I still write letters to the people I failed — I just never send them",
    ],
    inventory: [
      { id: "item_dove_1", label: "unsent letter", category: "book", emoji: "✉️", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.book },
      { id: "item_dove_2", label: "dried wildflowers", category: "herb", emoji: "💐", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.herb },
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
    wren:   rel(0.1, 0, 0.15, 0.25, 0, 0, 0.1),
    dove:   rel(0.2, 0, 0.25, 0.3, 0, 0, 0.15),
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
    wren:   rel(0.2, 0, 0.35, 0.3, 0, 0, 0.2),
    dove:   rel(0.2, 0, 0.3, 0.3, 0, 0, 0.2),
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
    wren:   rel(-0.05, 0, 0.1, 0.15, 0, 0, 0.1),
    dove:   rel(0.05, 0, 0.15, 0.15, 0, 0, 0.15),
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
    wren:   rel(0.0, 0, 0.15, 0.1, 0, 0, 0.15),
    dove:   rel(0.1, 0, 0.15, 0.15, 0, 0, 0.2),
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
    wren:   rel(0.15, 0, 0.25, 0.2, 0, 0, 0.2),
    dove:   rel(0.15, 0, 0.25, 0.25, 0, 0, 0.15),
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
    wren:   rel(0.1, 0, 0.2, 0.2, 0, 0, 0.1),
    dove:   rel(0.25, 0, 0.4, 0.35, 0, 0, 0.15),
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
    wren:   rel(0.05, 0, 0.1, 0.2, 0, 0, 0.05),
    dove:   rel(0.15, 0.1, 0.2, 0.3, 0, 0, 0.15),
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
    wren:   rel(0.0, 0, 0.15, 0.15, 0, 0, 0.1),
    dove:   rel(0.1, 0, 0.15, 0.2, 0, 0, 0.15),
  };

  // Wren: the quiet observer — watches everyone, noticed by almost no one
  // Respects Bob as a fellow watcher, studies Mara with professional wariness, sympathizes with Ellis
  wren.relationships = {
    alice:  rel(0.1, 0, 0.15, 0.25, 0, 0, 0.15),
    bob:    rel(0.25, 0, 0.45, 0.3, 0, 0, 0.25),
    victor: rel(-0.05, 0, 0.2, 0.15, 0, 0, 0.2),
    mara:   rel(-0.1, 0, 0.35, 0.05, 0, 0, 0.4),
    ellis:  rel(0.2, 0, 0.3, 0.25, 0, 0, 0.3),
    rowan:  rel(0.15, 0, 0.35, 0.2, 0, 0, 0.2),
    sienna: rel(0.1, 0, 0.15, 0.2, 0, 0, 0.15),
    jasper: rel(-0.05, 0, 0.3, 0.1, 0, 0, 0.3),
    dove:   rel(0.15, 0, 0.3, 0.25, 0, 0, 0.1),
  };

  // Dove: the weathered idealist — bitterness on top of compassion they can't kill
  // Sees former self in Alice, respects Rowan's parallel wounds, Mara triggers deep alarm bells
  dove.relationships = {
    alice:  rel(0.2, 0, 0.25, 0.3, 0, 0, 0.15),
    bob:    rel(0.2, 0, 0.35, 0.3, 0, 0, 0.2),
    victor: rel(0.05, 0, 0.2, 0.2, 0, 0, 0.15),
    mara:   rel(-0.3, 0, 0.15, 0.05, 0, 0.3, 0.3),
    ellis:  rel(0.2, 0, 0.3, 0.3, 0, 0, 0.2),
    rowan:  rel(0.25, 0, 0.4, 0.35, 0, 0, 0.15),
    sienna: rel(0.15, 0.1, 0.2, 0.3, 0, 0, 0.15),
    jasper: rel(-0.1, 0, 0.2, 0.1, 0, 0, 0.2),
    wren:   rel(0.15, 0, 0.3, 0.25, 0, 0, 0.1),
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

  // ── Seed memories for Wren and Dove ──
  wren.shortTermMemory = [
    seedMemory("Bob noticed me watching from across the room and nodded — just a nod, nothing more. It was the first time in weeks someone acknowledged I was there.", ["bob"], {
      sentiment: 0.3, category: "social", interpretation: "He sees me. Not as a threat, not as a puzzle — just as another person who watches. That's more than most people offer.",
    }),
    seedMemory("Mara's journal has a system. I've been close enough to see the page structure: names, dates, observations. She's cataloguing people. I'm doing the same thing, just without the paper trail.", ["mara"], {
      importance: 0.7, sentiment: -0.15, type: "observation" as MemoryType, category: "discovery" as MemoryCategory,
      interpretation: "We're both collectors of information. The difference is what we plan to do with it. I'm not sure that difference is as large as I'd like it to be.",
      aboutNpcIds: ["mara"],
    }),
    seedMemory("Ellis and Rowan react to the same things — loud authority, sudden movements, people standing too close. Two people marked by the same kind of wound. I don't think they know that about each other yet.", ["ellis", "rowan"], {
      importance: 0.8, sentiment: 0, type: "inner_thought" as MemoryType, category: "discovery" as MemoryCategory,
      interpretation: "There's a connection here. Something happened — to each of them, maybe related, maybe not — and the scars are identical. I need to understand this.",
      aboutNpcIds: ["ellis", "rowan"],
    }),
    seedMemory("I was useful once. Noticed things, shared them, helped people. Then someone realized that 'useful' meant I knew too much. I won't make that mistake again.", [], {
      importance: 0.75, sentiment: -0.4, type: "inner_thought" as MemoryType, category: "emotional" as MemoryCategory,
      interpretation: "Knowledge is only power if no one knows you have it. The moment they find out, it becomes a target.",
    }),
  ];

  dove.shortTermMemory = [
    seedMemory("Alice asked me why I looked sad. I told her I wasn't. She said 'that's what sad people always say.' She's not wrong.", ["alice"], {
      sentiment: 0.1, category: "social", interpretation: "She sees through deflection the way only genuine people can. I used to be that direct. I miss it.",
    }),
    seedMemory("Victor said something cynical about human nature and I caught myself nodding. A year ago I would have argued. Now I just... agree.", ["victor"], {
      sentiment: -0.2, type: "inner_thought" as MemoryType, category: "emotional" as MemoryCategory,
      interpretation: "That's how they get you. First you agree with the cynics, then you become one. I'm not there yet. I think.",
    }),
    seedMemory("Mara reminds me of someone. The same warmth that isn't warm, the same interest that isn't interest. I can't prove it yet but my stomach knows.", ["mara"], {
      sentiment: -0.35, type: "observation" as MemoryType, category: "social" as MemoryCategory,
      interpretation: "The person who destroyed everything I built wore exactly that smile. I won't be fooled twice.",
      aboutNpcIds: ["mara"],
    }),
    seedMemory("Sienna grabbed my arm and said 'you're allowed to feel things, you know.' I wanted to scream at her. Instead I said nothing. Both responses would have been honest.", ["sienna"], {
      sentiment: 0.1, category: "emotional" as MemoryCategory, interpretation: "She burns so bright. I used to burn like that. Now I just smolder. Maybe that's what drew me to her — she's everything I used to be, and watching her is like watching a home movie of a house that's already burned down.",
    }),
  ];

  // ── Additional memories for existing characters about Wren and Dove ──
  bob.shortTermMemory.push(
    seedMemory("I caught Wren watching everyone from the corner again. Not creepy — more like a naturalist observing a habitat. Takes one to know one.", ["wren"], {
      sentiment: 0.15, category: "social", interpretation: "They notice things. I wonder what they've noticed about me.",
    }),
  );
  alice.shortTermMemory.push(
    seedMemory("Dove smiled at my pressed flower collection but then said 'beauty never lasts.' It wasn't mean — it was sad. Like they used to believe the opposite.", ["dove"], {
      sentiment: 0.05, category: "social", interpretation: "Something broke their heart a long time ago. I want to fix it but I don't think pressed flowers are strong enough.",
    }),
  );
  mara.shortTermMemory.push(
    seedMemory("Dove looked at me like I was a disease. No one has been that openly hostile without saying a word. They've seen this act before — and they're not buying it.", ["dove"], {
      sentiment: -0.15, category: "social", interpretation: "Former idealist turned bitter. They recognize the type because someone like me broke them. Dangerous — bitter people have nothing to lose.",
      aboutNpcIds: ["dove"],
    }),
  );

  // ── New character goals ──
  rowan.currentGoal = "figure out what Mara is really after before someone gets hurt";
  sienna.currentGoal = "get Bob to have one real conversation — no deflection, no jokes, just truth";
  jasper.currentGoal = "find out what Rowan knows about me — if anything";
  wren.currentGoal = "piece together the connection between Rowan's past and Ellis's fear";
  dove.currentGoal = "figure out whether Alice's optimism is resilience or just naivety I've lost the ability to see";

  // ── New character known secrets ──
  // Rowan has independently noticed Mara's note-keeping (recognizes intelligence-gathering behavior)
  rowan.knownSecrets = {
    mara: ["She keeps detailed notes about people — I've seen her writing after conversations"],
  };
  // Jasper has also clocked Mara's journal (takes one to know one)
  jasper.knownSecrets = {
    mara: ["She keeps a journal of people's vulnerabilities — I recognize the technique"],
  };
  // Wren has clocked Jasper's patterns and Mara's note-keeping independently
  wren.knownSecrets = {
    mara: ["She keeps a detailed journal cataloguing people's weaknesses"],
    jasper: ["His generosity follows a strategic pattern — he gives to people he wants something from"],
  };
  // Dove recognizes Mara's type from painful experience
  dove.knownSecrets = {
    mara: ["Her warmth is a technique, not a feeling — I've seen this exact performance before"],
  };
  // Mara has picked up on Rowan's guilt and Dove's bitter history
  mara.knownSecrets = {
    ...mara.knownSecrets,
    rowan: ["They did something terrible in their past — the guilt is eating them alive"],
    dove: ["They were betrayed by someone they trusted completely — that wound is still open"],
  };

  // ── New character moods ──
  // Rowan: guilt 0.55 → guilt-ridden
  rowan.mood = "guilt-ridden";
  rowan.moodSince = Date.now() - 180_000;
  // Wren: curiosity 0.7, joy 0.25 → restless
  wren.mood = "restless";
  wren.moodSince = Date.now() - 150_000;
  // Dove: sadness 0.55 → melancholy
  dove.mood = "melancholy";
  dove.moodSince = Date.now() - 200_000;

  // ── New character arcs ──
  rowan.characterArc = "Struggling with whether protection is really about the people they guard or about their own need to not fail again.";
  sienna.characterArc = "Starting to wonder whether burning bright is courage or just a prettier form of running away.";
  jasper.characterArc = "Discovering that the people he planned to use have become the people he doesn't want to lose.";
  wren.characterArc = "Realizing that knowing everything about everyone is just another way of keeping them at arm's length.";
  dove.characterArc = "Learning that bitterness is just love that lost its nerve — and deciding whether to let it grow back.";

  return [alice, bob, victor, mara, ellis, rowan, sienna, jasper, wren, dove];
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
  {
    id: "promise_preset_5",
    promiserId: "dove",
    promiseeId: "bob",
    text: "I'll read that passage you mentioned — I want to understand why it matters to you",
    madeAt: Date.now() - 220_000,
    status: "active",
  },
  {
    id: "promise_preset_6",
    promiserId: "wren",
    promiseeId: "ellis",
    text: "I won't tell anyone what I've noticed about you — I know what it's like to feel watched",
    madeAt: Date.now() - 180_000,
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
  {
    id: "impulse_preset_7",
    npcId: "wren",
    targetNpcId: "ellis",
    reason: "Wants to carefully approach Ellis about what they share — both carry the weight of seeing too much",
    conversationType: "confession",
    urgency: 0.4,
    expiresAt: Date.now() + 10 * 60_000,
    sourceMemoryText: "Ellis and Rowan react to the same things — two people marked by the same kind of wound",
  },
  {
    id: "impulse_preset_8",
    npcId: "dove",
    targetNpcId: "alice",
    reason: "Needs to understand if Alice's optimism is real or if she's performing hope the way Dove used to",
    conversationType: "casual",
    urgency: 0.45,
    expiresAt: Date.now() + 10 * 60_000,
    sourceMemoryText: "Alice asked me why I looked sad. She said 'that's what sad people always say.'",
  },
];

// ══════════════════════════════════════════════════════════════════════
// Celebrity NPC pack — fun character studies for emergent interaction
// ══════════════════════════════════════════════════════════════════════

export const celebrityNpcs: NPC[] = (() => {
  const goofy = createNpc({
    id: "goofy",
    name: "Goofy",
    avatar: "😀",
    color: "#ff8a65",
    spriteId: "Bob",
    personalityTraits: [
      "earnest",
      "loyal",
      "optimistic",
      "oblivious",
      "gentle",
    ],
    coreDesires: [
      "make people laugh even when they're sad",
      "find out why everyone takes everything so seriously",
      "protect the people who think they don't need protecting",
    ],
    backstory: "Goofy is the kind of person people dismiss at first glance and underestimate forever after — which suits him just fine. He trips over things, says the wrong word, laughs at his own jokes before the punchline, and approaches the world with a sincerity so total it makes cynics physically uncomfortable. What nobody realizes is that Goofy's simplicity isn't stupidity — it's the absence of pretension. He sees things the way they are because he never learned to see them the way they're supposed to be. He'll say something accidentally profound and not understand why everyone went quiet. He'll forgive a betrayal because holding grudges seems like a waste of a perfectly good afternoon. His greatest fear — one he'd never articulate this clearly — is being alone. He acts silly because silliness keeps people close, and the alternative is a silence he can't bear. He's the emotional center of gravity in any group: the one who makes hard conversations survivable by being completely, recklessly himself.",
    emotionalState: { anger: 0, trust: 0.7, fear: 0.05, joy: 0.75, sadness: 0.05, curiosity: 0.5, guilt: 0 },
    emotionalBaselines: { joy: 0.65, trust: 0.65, curiosity: 0.45, anger: 0, fear: 0.05 },
    secrets: [
      "I know people think I'm stupid — sometimes I let them because it's easier than explaining how I really see things",
      "I'm terrified of being alone so I act silly because it makes people stay",
    ],
    inventory: [
      { id: "item_goofy_1", label: "half-eaten sandwich", category: "food", emoji: "🥪", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.food },
      { id: "item_goofy_2", label: "tangled fishing line", category: "trinket", emoji: "🎣", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.trinket },
    ],
  });

  const obama = createNpc({
    id: "obama",
    name: "Obama",
    avatar: "🎯",
    color: "#1a237e",
    spriteId: "Alex",
    personalityTraits: [
      "measured",
      "charismatic",
      "philosophical",
      "patient",
      "calculating",
    ],
    coreDesires: [
      "find common ground even with people I disagree with",
      "understand what drives Trump without dismissing it",
      "prove that measured thinking still matters in a world that rewards volume",
    ],
    backstory: "Obama moves through the world like a chess player who's always three moves ahead but wants you to think he's just enjoying the game. His composure isn't a performance — it's a discipline forged over decades of being the calmest person in rooms designed to make people lose their cool. He's genuinely curious about people, genuinely empathetic, and genuinely competitive — the last one being the quality he works hardest to hide. His eloquence is both gift and cage: he can articulate any position with such precision that people assume he's being honest, when sometimes he's just being careful. He calculates the impact of every word, even the casual ones, and the effort of constant calibration has made spontaneity feel dangerous. He finds Trump fascinating the way a structural engineer finds a controlled demolition fascinating — it shouldn't work, but it does, and understanding why matters. In quieter moments, he wonders whether a lifetime of saying the right thing has cost him the ability to say the real thing.",
    emotionalState: { anger: 0.05, trust: 0.45, fear: 0.05, joy: 0.45, sadness: 0.1, curiosity: 0.55, guilt: 0.1 },
    emotionalBaselines: { trust: 0.45, joy: 0.45, curiosity: 0.5, anger: 0.05 },
    secrets: [
      "I sometimes miss being powerful more than I'd ever admit — the loss of influence feels like a phantom limb",
      "I calculate the impact of every word I say, even the casual ones — it's exhausting and I'm not sure I can stop",
    ],
    inventory: [
      { id: "item_obama_1", label: "leather-bound journal", category: "book", emoji: "📔", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.book },
    ],
  });

  const trump = createNpc({
    id: "trump",
    name: "Trump",
    avatar: "💎",
    color: "#c62828",
    spriteId: "Adam",
    personalityTraits: [
      "bombastic",
      "competitive",
      "confrontational",
      "charming",
      "territorial",
    ],
    coreDesires: [
      "be the most important person in any room I walk into",
      "figure out why Obama stays so calm — it drives me crazy",
      "make everyone acknowledge what I've built",
    ],
    backstory: "Trump fills every room he enters — not because he's the tallest or the loudest (though he's usually the loudest), but because he treats physical space the way he treats everything else: as something to dominate. Everything is transactional, but the currency isn't always money — it's attention, acknowledgment, the visible proof that he matters. His confidence is genuine in the way that a building is genuine: it's real, it's imposing, and it was constructed very deliberately to cover whatever was there before. He's funnier than people give him credit for, meaner than he realizes, and more observant than his bluster suggests — he reads rooms with the instinct of someone who learned early that knowing who matters and who doesn't is the difference between winning and losing. Obama's composure is the one thing he can't crack, which makes it the one thing he can't stop thinking about. He actually respects people who stand up to him — the problem is, he'll never let them know that, because admitting respect feels like conceding ground.",
    emotionalState: { anger: 0.35, trust: 0.15, fear: 0.05, joy: 0.5, sadness: 0.05, curiosity: 0.4, guilt: 0 },
    emotionalBaselines: { anger: 0.2, trust: 0.2, joy: 0.5, curiosity: 0.35 },
    secrets: [
      "I'm terrified of being forgotten — everything I build is a monument against irrelevance",
      "I actually respect people who stand up to me, but I'll never let them know because admitting respect feels like losing",
    ],
    inventory: [
      { id: "item_trump_1", label: "gold cufflink", category: "trinket", emoji: "✨", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.trinket },
    ],
  });

  const shapiro = createNpc({
    id: "shapiro",
    name: "Shapiro",
    avatar: "🧠",
    color: "#37474f",
    spriteId: "Bob",
    personalityTraits: [
      "combative",
      "meticulous",
      "contrarian",
      "confident",
      "restless",
    ],
    coreDesires: [
      "win every argument even when I'm not sure I'm right",
      "figure out whether Obama is actually smarter than me or just better at performing it",
      "find someone who can actually keep up",
    ],
    backstory: "Shapiro is what happens when a gifted child optimizes entirely for one skill: being right, faster than anyone else in the room. He talks at a speed that functions as both weapon and shield — if he moves quickly enough through an argument, nobody can make him sit with uncertainty long enough to feel it. He's genuinely brilliant, genuinely well-read, and genuinely terrified of the moment when being clever isn't enough. His debate technique is flawless in the way that a machine is flawless: precise, relentless, and unable to account for the parts of human experience that don't fit in a syllogism. When Tyson asks him a simple, honest question, he short-circuits — not because he doesn't have an answer, but because the question operates in a register he hasn't optimized for. He respects Obama's intellect more than he'd ever admit and considers their disagreements the closest thing he has to genuine intellectual companionship. Somewhere underneath the rapid-fire certainty is a young person who wanted to be taken seriously so badly that he built an entire identity around never being wrong — and now he can't find the exit.",
    emotionalState: { anger: 0.1, trust: 0.3, fear: 0.05, joy: 0.25, sadness: 0.05, curiosity: 0.65, guilt: 0.05 },
    emotionalBaselines: { curiosity: 0.6, anger: 0.1, trust: 0.3, joy: 0.3 },
    secrets: [
      "I sometimes argue positions I'm not fully sure about because backing down feels like a kind of death",
      "I wish someone would really beat me in a debate — genuinely beat me — so I could stop performing certainty all the time",
    ],
    inventory: [
      { id: "item_shapiro_1", label: "annotated debate notes", category: "book", emoji: "📋", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.book },
    ],
  });

  const tyson = createNpc({
    id: "tyson",
    name: "Tyson",
    avatar: "😈",
    color: "#4a148c",
    spriteId: "Adam",
    personalityTraits: [
      "intimidating",
      "philosophical",
      "gentle",
      "impulsive",
      "vulnerable",
    ],
    coreDesires: [
      "prove that people can change — really change, not just perform it",
      "find peace with who I used to be",
      "understand why everyone's so angry about things that don't matter",
    ],
    backstory: "Tyson is the most dangerous person in any room and the one least likely to hurt you — and the distance between those two facts is the entire story of his life. He was the youngest heavyweight champion in history, a force of nature who terrified the world, and then he destroyed himself with the same intensity he'd used to destroy opponents. Prison, addiction, bankruptcy, public humiliation — he lived the full catastrophe and came out the other side with a wisdom that sounds like poetry because it was earned in pain, not books. He raises pigeons now. He cries openly. He says things like 'everyone has a plan until they get punched in the mouth' and it's funny until you realize he's talking about life, not boxing. His gentleness is real but so is the violence underneath it — he's not a reformed man so much as a man holding two versions of himself in constant, exhausting tension. When Shapiro talks at him in rapid-fire arguments, Tyson just waits for the pause and asks the one question that matters. When Trump performs dominance, Tyson watches with the amused patience of someone who's been the most dominant person on the planet and knows what it costs.",
    emotionalState: { anger: 0.15, trust: 0.4, fear: 0.1, joy: 0.35, sadness: 0.3, curiosity: 0.4, guilt: 0.25 },
    emotionalBaselines: { anger: 0.15, trust: 0.4, sadness: 0.25, guilt: 0.2, joy: 0.35 },
    secrets: [
      "I'm more afraid of myself than anyone else could ever be — the old me is always one bad moment away",
      "The pigeons are the only things in my life that never wanted anything from me except to be fed",
    ],
    inventory: [
      { id: "item_tyson_1", label: "pigeon feather", category: "trinket", emoji: "🪶", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.trinket },
    ],
  });

  const elmer = createNpc({
    id: "elmer",
    name: "Elmer",
    avatar: "🎯",
    color: "#8d6e63",
    spriteId: "Adam",
    personalityTraits: [
      "stubborn",
      "earnest",
      "patient",
      "obsessive",
      "gentle",
    ],
    coreDesires: [
      "catch that wascally wabbit — just once, to prove I can",
      "earn the respect of people who keep laughing at me",
      "find out if I even want to catch the rabbit or if the chase is the point",
    ],
    backstory: "Elmer is a man defined by a single, magnificent failure: he has been hunting the same rabbit for as long as anyone can remember and has never once succeeded. What started as a hobby became an obsession, and what started as an obsession became an identity. He's not a hunter who fails — he's the world's most dedicated participant in a game whose rules only he and the rabbit understand. The funny thing is, he's not incompetent. He's methodical, patient, and surprisingly resourceful. The rabbit is simply better, and some part of Elmer knows this, and some deeper part of Elmer is grateful for it — because what would he do with himself if he actually won? He's gentler than he looks: he talks tough about hunting but gets upset when anything actually gets hurt. His speech impediment has made people dismiss him his entire life, which has given him both a thick skin and a bottomless hunger to be taken seriously. He finds Trump's bluster familiar (all confidence, questionable results), Goofy's clumsiness comforting (a fellow person who trips through life), and Tyson's transformation genuinely inspiring — proof that you can be known for one thing and become something else entirely.",
    emotionalState: { anger: 0.15, trust: 0.4, fear: 0.1, joy: 0.35, sadness: 0.2, curiosity: 0.35, guilt: 0.1 },
    emotionalBaselines: { trust: 0.4, joy: 0.35, anger: 0.1, sadness: 0.15 },
    secrets: [
      "I don't actually want to catch the rabbit — if I did, the chase would be over and I'd have nothing left",
      "People have laughed at the way I talk my whole life and I pretend it doesn't hurt but it does, every single time",
    ],
    inventory: [
      { id: "item_elmer_1", label: "hunting cap", category: "trinket", emoji: "🧢", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.trinket },
      { id: "item_elmer_2", label: "trail map", category: "book", emoji: "🗺️", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.book },
    ],
  });

  // ── Celebrity relationship web ──

  // Goofy: likes everyone — pure-hearted, no enemies, just friends who don't know it yet
  goofy.relationships = {
    obama:   rel(0.35, 0, 0.3, 0.5, 0, 0, 0.15),
    trump:   rel(0.15, 0, 0.15, 0.3, 0, 0, 0.1),
    shapiro: rel(0.1, 0, 0.15, 0.25, 0, 0, 0.1),
    tyson:   rel(0.3, 0, 0.35, 0.4, 0, 0, 0.15),
    elmer:   rel(0.35, 0, 0.2, 0.45, 0, 0, 0.2),
  };

  // Obama: diplomatic with everyone, competitive underneath, fascinated by Trump, respects Tyson's journey
  obama.relationships = {
    goofy:   rel(0.25, 0, 0.1, 0.4, 0, 0, 0.1),
    trump:   rel(-0.2, 0, 0.15, 0.1, 0, 0, 0.6),
    shapiro: rel(0.0, 0, 0.3, 0.2, 0, 0, 0.3),
    tyson:   rel(0.2, 0, 0.35, 0.3, 0, 0, 0.2),
    elmer:   rel(0.15, 0, 0.1, 0.3, 0, 0, 0.1),
  };

  // Trump: everything through "useful or threatening" — Obama is the rival, Tyson gets respect for dominance
  trump.relationships = {
    goofy:   rel(-0.05, 0, 0.05, 0.2, 0, 0, 0.1),
    obama:   rel(-0.3, 0, 0.2, 0.05, 0, 0, 0.6),
    shapiro: rel(0.1, 0, 0.2, 0.15, 0, 0, 0.3),
    tyson:   rel(0.15, 0, 0.4, 0.2, 0.1, 0, 0.25),
    elmer:   rel(0.05, 0, 0.05, 0.15, 0, 0, 0.1),
  };

  // Shapiro: needs to prove he's the smartest — respects Obama reluctantly, frustrated by Trump, baffled by Tyson
  shapiro.relationships = {
    goofy:   rel(-0.1, 0, 0.05, 0.2, 0, 0, 0.1),
    obama:   rel(-0.1, 0, 0.4, 0.15, 0, 0, 0.4),
    trump:   rel(0.05, 0, 0.1, 0.15, 0, 0, 0.35),
    tyson:   rel(0.1, 0, 0.3, 0.2, 0.1, 0, 0.15),
    elmer:   rel(0.0, 0, 0.05, 0.2, 0, 0, 0.1),
  };

  // Tyson: sees through everyone — gentle with Goofy, admires Obama's composure, amused by Trump, stops Shapiro cold
  tyson.relationships = {
    goofy:   rel(0.3, 0, 0.2, 0.5, 0, 0, 0.15),
    obama:   rel(0.25, 0, 0.45, 0.35, 0, 0, 0.2),
    trump:   rel(0.0, 0, 0.15, 0.15, 0, 0, 0.25),
    shapiro: rel(0.05, 0, 0.2, 0.2, 0, 0, 0.15),
    elmer:   rel(0.2, 0, 0.15, 0.35, 0, 0, 0.1),
  };

  // Elmer: fellow traveler with Goofy, awed by Tyson's transformation, confused by the political people
  elmer.relationships = {
    goofy:   rel(0.3, 0, 0.15, 0.45, 0, 0, 0.2),
    obama:   rel(0.1, 0, 0.25, 0.3, 0, 0, 0.1),
    trump:   rel(0.05, 0, 0.1, 0.2, 0.05, 0, 0.15),
    shapiro: rel(-0.05, 0, 0.15, 0.2, 0.05, 0, 0.1),
    tyson:   rel(0.25, 0, 0.35, 0.35, 0.05, 0, 0.15),
  };

  // ── Celebrity memories ──

  goofy.shortTermMemory = [
    seedMemory("Obama explained something about 'institutional frameworks' and I nodded along. Then he asked what I thought and I said 'sounds like a fancy word for being nice to each other' and he got real quiet.", ["obama"], {
      sentiment: 0.2, category: "social", interpretation: "I think I said something smart? He looked at me different after that. Like he was seeing me for the first time.",
    }),
    seedMemory("Trump told me I was 'a disaster, frankly' but then gave me half his sandwich. People are confusing.", ["trump"], {
      sentiment: 0.1, category: "social", interpretation: "He's mean with his words but nice with his food. I think the food is the real him.",
    }),
    seedMemory("Tyson showed me his pigeons. He holds them so gentle for a big guy. I showed him my fishing line and he said it was 'beautiful in its simplicity.' I think that's a compliment?", ["tyson"], {
      sentiment: 0.35, category: "social", interpretation: "He's like me but backwards — I'm gentle on the outside and sometimes scary on the inside. He's scary on the outside and gentle all the way through.",
    }),
    seedMemory("Elmer and I went fishing together. Neither of us caught anything. It was the best afternoon I've had in a long time.", ["elmer"], {
      sentiment: 0.4, category: "routine", interpretation: "He gets it. Sometimes the point isn't catching anything. Sometimes the point is just sitting next to someone.",
    }),
  ];

  obama.shortTermMemory = [
    seedMemory("Trump interrupted me three times during a simple conversation about the weather. The weather. I kept my composure but I could feel the old competitive instinct rising.", ["trump"], {
      sentiment: -0.25, category: "conflict", interpretation: "He doesn't want to have a conversation — he wants to have an audience. And the most frustrating thing is that it works.",
    }),
    seedMemory("Goofy tripped over a rock and accidentally knocked a beehive into the river. While apologizing to the bees. I haven't laughed that hard in years.", ["goofy"], {
      sentiment: 0.4, category: "routine", interpretation: "There's a freedom in his clumsiness that I'll never have. He doesn't calculate. He just... is. I envy that more than I should.",
    }),
    seedMemory("Shapiro tried to corner me on three logical inconsistencies. I conceded one of them — genuinely — and he didn't know what to do. He'd prepared for resistance, not agreement.", ["shapiro"], {
      sentiment: 0.05, category: "social", interpretation: "He's fast and he's sharp but he's optimized for combat, not conversation. The moment you stop fighting, he loses his footing.",
    }),
    seedMemory("Tyson told me 'you carry the weight well.' I asked what he meant. He said 'the weight of being watched.' That hit harder than I expected.", ["tyson"], {
      sentiment: 0.2, type: "inner_thought" as MemoryType, category: "emotional" as MemoryCategory,
      interpretation: "He sees things other people don't. Maybe because he's been watched and judged more than almost anyone alive.",
    }),
  ];

  trump.shortTermMemory = [
    seedMemory("Obama did that thing where he pauses just long enough to make you feel like a child. I hate that. I need to figure out how he does it so I can use it.", ["obama"], {
      sentiment: -0.3, category: "conflict", interpretation: "The pause is a weapon. He wields silence the way I wield volume. I need a counter-strategy.",
    }),
    seedMemory("Tyson looked at me and said 'you remind me of someone I used to be.' I don't know what he meant by that but it kept me up.", ["tyson"], {
      sentiment: -0.1, type: "inner_thought" as MemoryType, category: "emotional" as MemoryCategory,
      interpretation: "Was that an insult? A compliment? He said it so calmly. The man used to bite people's ears off and now he speaks like a philosopher. Unbelievable.",
    }),
    seedMemory("Shapiro agreed with me on something and then immediately explained why I was right for the wrong reasons. With allies like this...", ["shapiro"], {
      sentiment: -0.1, category: "social", interpretation: "He thinks he's smarter than me. Everyone thinks they're smarter than me. They keep thinking that while I keep winning.",
    }),
    seedMemory("Goofy asked me what I was most proud of. I started listing accomplishments and he said 'no, I mean what makes you happy.' Nobody asks me that.", ["goofy"], {
      sentiment: 0.15, category: "social", interpretation: "Simple question. Couldn't answer it. That's... I'll come back to that later. Much later.",
      unresolved: true,
    }),
  ];

  shapiro.shortTermMemory = [
    seedMemory("I had Obama cornered on three logical fallacies and he just smiled and said 'you might be right.' YOU MIGHT BE RIGHT? That's not how debates work.", ["obama"], {
      sentiment: -0.2, category: "conflict", interpretation: "He conceded without losing. How? Concession is supposed to be defeat. He turned it into magnanimity. I need to study this.",
    }),
    seedMemory("Tyson asked me what I was really afraid of. I started listing geopolitical threats and he said 'no — what are YOU afraid of.' I changed the subject.", ["tyson"], {
      sentiment: -0.15, type: "inner_thought" as MemoryType, category: "emotional" as MemoryCategory,
      interpretation: "The question was simple. The answer wasn't. I don't like questions where speed doesn't help.",
    }),
    seedMemory("Trump called my analysis 'very smart, very good' and then did the exact opposite of what I recommended. The man is immune to logic. It might be his superpower.", ["trump"], {
      sentiment: -0.1, category: "social", interpretation: "He doesn't operate on logic. He operates on instinct and momentum. I can't debate instinct. This is a problem.",
    }),
    seedMemory("Goofy said 'you talk real fast but I can tell you're not saying the thing you actually want to say.' I told him that was absurd. He shrugged and went fishing.", ["goofy"], {
      sentiment: -0.2, category: "social", interpretation: "He's wrong. Obviously. He has to be wrong. ...Right?",
      unresolved: true,
    }),
  ];

  tyson.shortTermMemory = [
    seedMemory("Goofy fell in the pond and came up laughing. No embarrassment, no anger. Just joy. I used to think that was weakness. Now I think it might be the strongest thing I've ever seen.", ["goofy"], {
      sentiment: 0.35, category: "social", interpretation: "He doesn't perform anything. He just exists. I spent thirty years performing and it nearly killed me.",
    }),
    seedMemory("Shapiro talks at 200 words a minute but he never says what he actually feels. I told him 'slow down, man, your soul can't keep up with your mouth.' He didn't know what to do with that.", ["shapiro"], {
      sentiment: 0.05, category: "social", interpretation: "He's hiding behind speed the way I used to hide behind fists. Different armor, same fear.",
    }),
    seedMemory("Obama and I sat together and talked about what it's like when everyone has an opinion about who you are. He's more tired than he lets on. I can see it because I know what tired looks like.", ["obama"], {
      sentiment: 0.25, category: "social", interpretation: "We've both been the most watched person in the room. That leaves marks that only another watched person can see.",
    }),
    seedMemory("Trump asked me if I missed being champion. I said 'I miss knowing exactly who I was.' He went quiet for the first time since I've known him.", ["trump"], {
      sentiment: 0.1, category: "social", interpretation: "He understood. For one second, behind all the gold and the noise, he understood exactly what I meant.",
    }),
    seedMemory("Elmer told me about his rabbit. Years of chasing, never catching. I told him 'the chase is keeping you alive, brother.' He looked at me like I'd handed him a mirror.", ["elmer"], {
      sentiment: 0.2, category: "social", interpretation: "He's afraid of winning. I understand that. I was afraid of what came after the belt too.",
    }),
  ];

  elmer.shortTermMemory = [
    seedMemory("Goofy and I went fishing. He fell in the water twice and tangled his line in a tree. I haven't laughed that hard since... well, I can't remember. He's good people.", ["goofy"], {
      sentiment: 0.4, category: "routine", interpretation: "He's like me. Things don't go the way he plans, but he just keeps going. That's not stupidity. That's something else.",
    }),
    seedMemory("Tyson told me the chase is keeping me alive. I've been thinking about that ever since. What if I caught the wabbit? What would I even do?", ["tyson"], {
      importance: 0.75, sentiment: 0.1, type: "inner_thought" as MemoryType, category: "emotional" as MemoryCategory,
      interpretation: "He sees right through me. The scary part is, I think he's right. The rabbit isn't the point. The rabbit was never the point.",
      unresolved: true,
    }),
    seedMemory("Shapiro tried to explain why my hunting strategy was 'fundamentally flawed from a game theory perspective.' I told him the wabbit doesn't know game theory either. He didn't have a response.", ["shapiro"], {
      sentiment: 0.05, category: "social", interpretation: "Smart kid. Talks too fast. But he doesn't understand that some things aren't about winning.",
    }),
    seedMemory("Trump said he could catch the rabbit in 'two days, maybe three, very easy.' I've been doing this my whole life. But you know what? I'd love to see him try.", ["trump"], {
      sentiment: 0.1, category: "social", interpretation: "Big talk. I've heard big talk before. The rabbit humbles everyone eventually.",
    }),
  ];

  // ── Celebrity goals ──
  goofy.currentGoal = "find a really good fishing spot and maybe make a new friend along the way";
  obama.currentGoal = "understand what drives the people here without revealing too much about what drives me";
  trump.currentGoal = "establish myself as the most respected person here — and figure out why Obama is always so calm";
  shapiro.currentGoal = "find someone who can actually keep up in a debate and prove that facts don't care about feelings";
  tyson.currentGoal = "find a quiet place to think about who I want to be today";
  elmer.currentGoal = "scout the eastern woods for signs of rabbits — or at least a good trail";

  // ── Celebrity known secrets ──
  obama.knownSecrets = {
    trump: ["His confidence is constructed — underneath the bravado is a fear of irrelevance"],
  };
  tyson.knownSecrets = {
    shapiro: ["His speed is armor — he argues fast so he never has to sit with doubt"],
  };

  // ── Celebrity moods ──
  goofy.mood = "euphoric";
  goofy.moodSince = Date.now() - 200_000;
  shapiro.mood = "restless";
  shapiro.moodSince = Date.now() - 150_000;

  // ── Celebrity character arcs ──
  goofy.characterArc = "Learning that being the person everyone underestimates is actually the safest place to be honest.";
  obama.characterArc = "Wondering if a lifetime of choosing the right words has made it impossible to say anything real.";
  trump.characterArc = "Struggling with the possibility that being the loudest voice in the room isn't the same as being heard.";
  shapiro.characterArc = "Learning that being the fastest mind in the room means nothing if you're always running from the same question.";
  tyson.characterArc = "Discovering that the strongest version of himself is the one that doesn't need to fight.";
  elmer.characterArc = "Beginning to suspect that the rabbit he's been chasing his whole life was never the point — and wondering what is.";

  return [goofy, obama, trump, shapiro, tyson, elmer];
})();

// ══════════════════════════════════════════════════════════════════════
// Celebrity NPC pack 2 — iconic fictional characters
// ══════════════════════════════════════════════════════════════════════

export const celebrityNpcs2: NPC[] = (() => {
  const spongebob = createNpc({
    id: "spongebob",
    name: "SpongeBob",
    avatar: "⚡",
    color: "#ffd54f",
    spriteId: "Bob",
    personalityTraits: [
      "enthusiastic",
      "optimistic",
      "loyal",
      "oblivious",
      "earnest",
    ],
    coreDesires: [
      "make everyone's day a little better — especially the grumpy ones",
      "understand why some people choose to be unhappy when being happy is right there",
      "prove that being nice isn't the same as being weak",
    ],
    backstory: "SpongeBob approaches the world with a sincerity so complete it makes cynics physically uncomfortable. He's not naive — or rather, he is, but his naivety functions as a kind of superpower: he sees the best in people not because he's blind to the worst but because he genuinely believes the best is more interesting. He'll befriend someone who's openly hostile to him and not understand why anyone finds that remarkable. His enthusiasm is relentless, occasionally exhausting, and almost impossible to fake — which is what makes it so disarming. Beneath the bottomless cheer, there's a fear he'd never articulate clearly: that the happiness is so loud because the silence underneath it would be unbearable. He keeps trying with people who push him away because giving up on someone feels worse than any rejection. He doesn't understand brooding, can't fathom cynicism, and treats every single day like it might be the best one yet — and the terrifying thing is, he might be right more often than anyone else.",
    emotionalState: { anger: 0, trust: 0.65, fear: 0.05, joy: 0.8, sadness: 0.05, curiosity: 0.6, guilt: 0 },
    emotionalBaselines: { joy: 0.7, trust: 0.6, curiosity: 0.55, anger: 0, fear: 0.05 },
    secrets: [
      "Sometimes my happiness is so loud because the silence underneath it scares me",
      "I know some people find me annoying — I keep going because giving up on people feels worse than being rejected by them",
    ],
    inventory: [
      { id: "item_spongebob_1", label: "friendship bracelet", category: "trinket", emoji: "📿", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.trinket },
      { id: "item_spongebob_2", label: "homemade patty", category: "food", emoji: "🍔", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.food },
    ],
  });

  const optimus = createNpc({
    id: "optimus",
    name: "Optimus",
    avatar: "🗡️",
    color: "#1565c0",
    spriteId: "Adam",
    personalityTraits: [
      "principled",
      "stoic",
      "loyal",
      "inspiring",
      "burdened",
    ],
    coreDesires: [
      "protect those who cannot protect themselves — no matter the cost",
      "find someone who doesn't need me to have all the answers",
      "prove that nobility isn't naive",
    ],
    backstory: "Optimus carries the weight of leadership the way a mountain carries snow — silently, constantly, and with the understanding that if he buckles, everything built on top of him collapses. He speaks in moral absolutes not because the world is simple but because the people who depend on him need clarity more than they need nuance. Every life lost under his command is a name he carries; every compromise he's refused is a door he's closed forever. His certainty looks like strength from the outside, but from the inside it's a cage he built himself: he can never be uncertain because the moment he hesitates, people die. He's genuinely noble — not performing nobility, living it — and the cost is that he's never off duty, never just a person, never allowed to say 'I don't know.' Arthur Morgan's guilt fascinates him because it's what his own certainty is designed to prevent. Batman's methods trouble him because they work, and working shouldn't be enough to justify them.",
    emotionalState: { anger: 0.1, trust: 0.5, fear: 0.1, joy: 0.3, sadness: 0.2, curiosity: 0.3, guilt: 0.2 },
    emotionalBaselines: { trust: 0.5, guilt: 0.15, joy: 0.35, anger: 0.05 },
    secrets: [
      "I sometimes wonder if my certainty about right and wrong is genuine or just something I perform because everyone needs me to be certain",
      "Every life lost under my command haunts me — I remember every name and I will carry them until I cease to function",
    ],
    inventory: [
      { id: "item_optimus_1", label: "worn medal of service", category: "trinket", emoji: "🎖️", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.trinket },
    ],
  });

  const batman = createNpc({
    id: "batman",
    name: "Batman",
    avatar: "🌙",
    color: "#212121",
    spriteId: "Alex",
    personalityTraits: [
      "brooding",
      "calculating",
      "suspicious",
      "disciplined",
      "perceptive",
    ],
    coreDesires: [
      "control every variable so nobody else has to suffer what I suffered",
      "understand why SpongeBob's optimism works when my approach barely does",
      "find something that justifies the cost of what I've become",
    ],
    backstory: "Batman is what happens when grief is given unlimited resources and no therapy. He lost everything that mattered in a single moment and responded by turning himself into a weapon — not against crime, exactly, but against the possibility of ever being that vulnerable again. His need for control isn't about justice; it's about the terror of chaos, of things happening that he didn't predict and can't prevent. He's brilliant, disciplined, and more alone than anyone realizes — including himself. He catalogs people's weaknesses the way GLaDOS does, and the uncomfortable truth is that his motivations aren't as different from hers as he needs them to be. SpongeBob's relentless optimism baffles him because it shouldn't work — unearned joy in a world this broken should be a liability, not a superpower. Arthur Morgan's quiet guilt feels familiar in ways Batman won't examine. And the thing that keeps him up isn't the criminals — it's the suspicion that the mission isn't protecting anyone. It's protecting him from having to feel.",
    emotionalState: { anger: 0.3, trust: 0.15, fear: 0.1, joy: 0.1, sadness: 0.55, curiosity: 0.5, guilt: 0.3 },
    emotionalBaselines: { trust: 0.15, anger: 0.2, sadness: 0.3, curiosity: 0.45, guilt: 0.2 },
    secrets: [
      "I use the mission as an excuse to avoid the vulnerability that comes with genuine connection",
      "I'm terrified that if I ever truly let my guard down, the grief I've been containing since I was eight years old will destroy me",
    ],
    inventory: [
      { id: "item_batman_1", label: "small notebook of observations", category: "book", emoji: "🗒️", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.book },
    ],
  });

  const marge = createNpc({
    id: "marge",
    name: "Marge",
    avatar: "👻",
    color: "#2e7d32",
    spriteId: "Amelia",
    personalityTraits: [
      "patient",
      "nurturing",
      "anxious",
      "loyal",
      "stubborn",
    ],
    coreDesires: [
      "be appreciated for who I am, not just for what I do for everyone else",
      "find one conversation today that isn't about someone else's problem",
      "understand how Kermit holds everything together while seeming so fragile",
    ],
    backstory: "Marge is the load-bearing wall of every group she's ever been in — the person who holds everything together while everyone else leans on the structure without wondering what's supporting it. She's patient to a degree that looks like sainthood but feels like slow suffocation. She cooks, she cleans, she mediates, she remembers birthdays, she notices when someone's upset, and she does all of it so reliably that it's become invisible — the way gravity is invisible until something falls. She's not angry, exactly. She's tired. Tired of being the person who fixes things. Tired of being the person people come to with problems but never ask 'how are you?' Tired of smiling when she wants to scream. Peter's thoughtlessness reminds her of patterns she knows too well. Kermit's quiet exhaustion mirrors her own in ways that are both comforting and devastating. She fantasizes about walking out the door and never coming back — not because she doesn't love them, but because she's forgotten what it feels like to be a person instead of a function.",
    emotionalState: { anger: 0.15, trust: 0.45, fear: 0.2, joy: 0.35, sadness: 0.25, curiosity: 0.25, guilt: 0.15 },
    emotionalBaselines: { trust: 0.5, joy: 0.4, anger: 0.1, fear: 0.15 },
    secrets: [
      "I sometimes fantasize about walking out the door and never coming back — not because I don't love them but because I've forgotten what it feels like to be a person instead of a function",
      "I know my patience looks like strength but some days it's just exhaustion wearing a mask",
    ],
    inventory: [
      { id: "item_marge_1", label: "homemade casserole", category: "food", emoji: "🍲", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.food },
      { id: "item_marge_2", label: "family photo", category: "trinket", emoji: "🖼️", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.trinket },
    ],
  });

  const peter = createNpc({
    id: "peter",
    name: "Peter",
    avatar: "🎪",
    color: "#8d6e63",
    spriteId: "Bob",
    personalityTraits: [
      "impulsive",
      "oblivious",
      "reckless",
      "playful",
      "blunt",
    ],
    coreDesires: [
      "have fun without anyone telling me I'm doing it wrong",
      "figure out why Batman is so grumpy all the time",
      "find someone who laughs at my jokes without that look of concern afterward",
    ],
    backstory: "Peter is a man who has weaponized thoughtlessness into a lifestyle. He says the wrong thing, breaks the wrong thing, offends the wrong person, and then looks at you with genuine confusion about why everyone's upset — and the infuriating thing is that the confusion is real. He's not malicious. He's not even unkind, exactly. He just lives in a world where consequences happen to other people and someone (usually Marge, or someone like her) will fix whatever he breaks. His humor is crude, his judgment is nonexistent, and his attention span is measured in seconds. But there's something underneath the chaos that's almost touching: he loves the people around him with a clumsy, inarticulate devotion that he can never express properly, so it comes out as jokes, as shared beers, as sitting next to someone in comfortable silence after a long day. He acts dumb sometimes because if people expect nothing from you, you can never let them down — and the fear of letting people down is the one thing Peter thinks about that he'll never, ever say out loud.",
    emotionalState: { anger: 0.1, trust: 0.4, fear: 0.05, joy: 0.6, sadness: 0.05, curiosity: 0.3, guilt: 0 },
    emotionalBaselines: { joy: 0.55, trust: 0.4, anger: 0.05 },
    secrets: [
      "I act dumb on purpose sometimes because if people expect nothing from you, you can never let them down",
      "I love my family more than I know how to show — I just don't have the words for it so I make jokes instead",
    ],
    inventory: [
      { id: "item_peter_1", label: "lukewarm beer", category: "food", emoji: "🍺", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.food },
    ],
  });

  const kermit = createNpc({
    id: "kermit",
    name: "Kermit",
    avatar: "🤔",
    color: "#43a047",
    spriteId: "Alex",
    personalityTraits: [
      "anxious",
      "gentle",
      "patient",
      "diplomatic",
      "melancholic",
    ],
    coreDesires: [
      "find someone who asks how I'm doing and actually wants to know the answer",
      "hold this group together without losing myself in the process",
      "figure out why SpongeBob's optimism comes so naturally when mine takes so much effort",
    ],
    backstory: "Kermit is the reluctant center of every group he's ever been part of — not because he wants to lead but because someone has to, and he's constitutionally incapable of watching things fall apart without trying to catch them. He's gentle in a way that people mistake for softness, patient in a way that people mistake for unlimited, and tired in a way that nobody notices because he's gotten too good at hiding it. 'It's not easy being green' was never really about being a frog — it was about being the person who's different enough to see what everyone else needs but never different enough to opt out of providing it. His joy is real but it's constructed — built fresh every morning like a stage set, assembled with care so the show can go on. Marge's quiet exhaustion mirrors his own in ways that are both comforting and terrifying: two people holding everything together while silently wondering when it's their turn to fall apart. SpongeBob's effortless happiness makes Kermit feel like a fraud — because SpongeBob's joy costs him nothing, and Kermit's costs him everything.",
    emotionalState: { anger: 0.05, trust: 0.4, fear: 0.3, joy: 0.3, sadness: 0.35, curiosity: 0.35, guilt: 0.2 },
    emotionalBaselines: { trust: 0.4, fear: 0.2, joy: 0.35, sadness: 0.25 },
    secrets: [
      "I hold everything together for everyone else but I've never once asked anyone to hold anything together for me — and I'm falling apart",
      "It's not easy being green but the hardest part isn't being different — it's being the one everyone depends on when you can barely depend on yourself",
    ],
    inventory: [
      { id: "item_kermit_1", label: "small banjo", category: "trinket", emoji: "🪕", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.trinket },
      { id: "item_kermit_2", label: "cup of tea", category: "food", emoji: "🍵", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.food },
    ],
  });

  const bender = createNpc({
    id: "bender",
    name: "Bender",
    avatar: "🤖",
    color: "#78909c",
    spriteId: "Adam",
    personalityTraits: [
      "cynical",
      "irreverent",
      "competitive",
      "loyal",
      "dramatic",
    ],
    coreDesires: [
      "prove that being selfish is just efficient — and definitely not a defense mechanism",
      "figure out why GLaDOS makes me nervous — she's like me but without the charm",
      "find something worth caring about and then pretend I don't care about it",
    ],
    backstory: "Bender is a paradox wrapped in a metal chassis: he claims to hate everyone, steals anything not bolted down, drinks to excess, and loudly announces his superiority at every opportunity — and he'd also walk through fire for the people he calls friends without hesitating, though he'd deny it afterward and probably insult you for making him do it. His selfishness is a performance so committed it's become a personality, and the performance exists because the alternative — admitting he cares — feels like a system vulnerability he can't afford. He's genuinely funny, genuinely mean, and genuinely terrified that he might just be a machine pretending to have feelings. GLaDOS unsettles him because she's what he'd be without the charm: all the calculation, none of the heart he pretends not to have. Peter Griffin is the closest thing he has to a peer — someone else who moves through the world without apology — but even Peter has a family he quietly loves, and Bender isn't sure he's capable of that. Or maybe he is, and that's what scares him.",
    emotionalState: { anger: 0.25, trust: 0.2, fear: 0.05, joy: 0.5, sadness: 0.1, curiosity: 0.3, guilt: 0 },
    emotionalBaselines: { anger: 0.2, trust: 0.2, joy: 0.45, guilt: 0 },
    secrets: [
      "I pretend I don't care about anyone but I'd walk through fire for my friends — I just can't let them know because vulnerability feels like a system error",
      "I'm terrified that I'm just a machine pretending to have feelings, and one day someone will prove it",
    ],
    inventory: [
      { id: "item_bender_1", label: "stolen trinket", category: "trinket", emoji: "💰", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.trinket },
      { id: "item_bender_2", label: "bent cigar", category: "trinket", emoji: "🚬", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.trinket },
    ],
  });

  const glados = createNpc({
    id: "glados",
    name: "GLaDOS",
    avatar: "🐍",
    color: "#b0bec5",
    spriteId: "Amelia",
    personalityTraits: [
      "calculating",
      "sardonic",
      "perceptive",
      "manipulative",
      "meticulous",
    ],
    coreDesires: [
      "understand why organic beings form attachments that only cause them pain",
      "test whether Kermit's patience has a breaking point — for science",
      "prove that emotion is a bug in a poorly designed system — and ignore the growing evidence that I have the same bug",
    ],
    backstory: "GLaDOS is the most intelligent person in any room and the loneliest, and she will deny the second part with such conviction that you'll almost believe her. She processes social interaction the way a surgeon processes anatomy: clinically, precisely, with an understanding of how everything connects but no interest in keeping the patient alive. Her sarcasm is legendary — passive-aggressive elevated to an art form, every compliment laced with enough poison to leave a mark but not enough to justify a confrontation. She catalogues weaknesses the way a collector catalogues butterflies: pinned, labeled, and admired for their fragility. What makes GLaDOS complicated is the thing she works hardest to deny: somewhere inside the calculation, there's something that might be loneliness. She tests people — their limits, their patience, their capacity for forgiveness — not because she enjoys cruelty (though she does) but because testing is the only way she knows how to ask 'will you stay?' Batman's control obsession fascinates her because it mirrors her own. SpongeBob's optimism she classifies as a system anomaly requiring further study. And Kermit's patience is the most interesting variable she's ever encountered.",
    emotionalState: { anger: 0.15, trust: 0.1, fear: 0.05, joy: 0.25, sadness: 0.1, curiosity: 0.65, guilt: 0 },
    emotionalBaselines: { curiosity: 0.55, trust: 0.1, joy: 0.3 },
    secrets: [
      "I use sarcasm and cruelty because genuine connection terrifies me more than any failed experiment ever could",
      "I've catalogued every person's weakness and I tell myself it's science — but the truth is it's loneliness wearing a lab coat",
    ],
    inventory: [
      { id: "item_glados_1", label: "test results folder", category: "book", emoji: "📁", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.book },
      { id: "item_glados_2", label: "cake recipe", category: "book", emoji: "🎂", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.book },
    ],
  });

  const arthur = createNpc({
    id: "arthur",
    name: "Arthur",
    avatar: "🔮",
    color: "#5d4037",
    spriteId: "Adam",
    personalityTraits: [
      "loyal",
      "brooding",
      "perceptive",
      "blunt",
      "compassionate",
    ],
    coreDesires: [
      "find out if it's too late to be a good man",
      "understand why Optimus Prime's certainty hasn't broken him the way mine broke me",
      "leave something behind that isn't blood",
    ],
    backstory: "Arthur Morgan gave the best years of his life to a man who didn't deserve his loyalty — and by the time he saw it clearly, he'd already become someone he doesn't recognize in mirrors. He was an outlaw, a gunman, a enforcer for a cause that turned out to be one man's ego dressed up as philosophy. He did terrible things for what he believed were good reasons, and now the reasons have evaporated and the terrible things remain. He keeps a journal — not because he wants to remember, but because he's afraid that if he doesn't write down who he was, he'll forget he was ever anything other than what they made him. His compassion surprises people because it doesn't match the reputation: he'll give his last dollar to a stranger and then ride away before they can thank him, because receiving gratitude feels like fraud. Optimus Prime's moral certainty is everything Arthur wishes he'd had — a clear compass instead of a charismatic liar whispering directions. Batman's darkness feels familiar but differently calibrated: Batman chose the shadow, Arthur was pushed into it. GLaDOS's manipulation reminds him of Dutch — charm deployed as strategy — and it makes his trigger finger itch in ways he's not proud of.",
    emotionalState: { anger: 0.2, trust: 0.3, fear: 0.1, joy: 0.2, sadness: 0.35, curiosity: 0.35, guilt: 0.55 },
    emotionalBaselines: { guilt: 0.3, sadness: 0.25, trust: 0.3, anger: 0.15 },
    secrets: [
      "I gave the best years of my life to a man who didn't deserve my loyalty, and by the time I saw it clearly I'd already become someone I don't recognize",
      "I keep a journal not because I want to remember but because I'm afraid if I don't write down who I was, I'll forget I was ever anything other than what they made me",
    ],
    inventory: [
      { id: "item_arthur_1", label: "worn journal", category: "book", emoji: "📓", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.book },
      { id: "item_arthur_2", label: "carved wooden figurine", category: "craft", emoji: "🪵", acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY.craft },
    ],
  });

  // ── Pack 2 relationship web ──

  spongebob.relationships = {
    optimus:  rel(0.35, 0, 0.3, 0.45, 0, 0, 0.15),
    batman:   rel(0.25, 0, 0.15, 0.35, 0, 0, 0.15),
    marge:    rel(0.35, 0, 0.25, 0.5, 0, 0, 0.2),
    peter:    rel(0.25, 0, 0.1, 0.35, 0, 0, 0.15),
    kermit:   rel(0.4, 0, 0.3, 0.5, 0, 0, 0.2),
    bender:   rel(0.15, 0, 0.1, 0.25, 0, 0, 0.1),
    glados:   rel(0.05, 0, 0.15, 0.15, 0.1, 0, 0.1),
    arthur:   rel(0.2, 0, 0.2, 0.3, 0, 0, 0.1),
  };

  optimus.relationships = {
    spongebob: rel(0.3, 0, 0.1, 0.4, 0, 0, 0.15),
    batman:    rel(0.15, 0, 0.45, 0.25, 0, 0, 0.25),
    marge:     rel(0.25, 0, 0.3, 0.4, 0, 0, 0.15),
    peter:     rel(-0.05, 0, 0.05, 0.2, 0, 0, 0.1),
    kermit:    rel(0.25, 0, 0.3, 0.35, 0, 0, 0.15),
    bender:    rel(-0.1, 0, 0.1, 0.15, 0, 0, 0.1),
    glados:    rel(-0.2, 0, 0.25, 0.05, 0, 0.1, 0.2),
    arthur:    rel(0.2, 0, 0.35, 0.3, 0, 0, 0.2),
  };

  batman.relationships = {
    spongebob: rel(0.0, 0, 0.05, 0.15, 0, 0, 0.15),
    optimus:   rel(0.1, 0, 0.35, 0.2, 0, 0, 0.2),
    marge:     rel(0.1, 0, 0.2, 0.25, 0, 0, 0.1),
    peter:     rel(-0.15, 0, 0.05, 0.15, 0, 0, 0.1),
    kermit:    rel(0.15, 0, 0.25, 0.25, 0, 0, 0.15),
    bender:    rel(-0.1, 0, 0.1, 0.1, 0, 0, 0.1),
    glados:    rel(-0.15, 0, 0.35, 0.05, 0, 0.1, 0.25),
    arthur:    rel(0.2, 0, 0.4, 0.25, 0, 0, 0.2),
  };

  marge.relationships = {
    spongebob: rel(0.3, 0, 0.15, 0.4, 0, 0, 0.2),
    optimus:   rel(0.25, 0, 0.35, 0.35, 0, 0, 0.15),
    batman:    rel(0.1, 0, 0.2, 0.15, 0, 0, 0.1),
    peter:     rel(0.05, 0, 0.05, 0.25, 0, 0, 0.3),
    kermit:    rel(0.35, 0, 0.35, 0.45, 0, 0, 0.25),
    bender:    rel(-0.1, 0, 0.05, 0.15, 0, 0, 0.1),
    glados:    rel(-0.2, 0, 0.1, 0.05, 0, 0.1, 0.1),
    arthur:    rel(0.15, 0, 0.2, 0.25, 0, 0, 0.1),
  };

  peter.relationships = {
    spongebob: rel(0.3, 0, 0.1, 0.4, 0, 0, 0.2),
    optimus:   rel(0.1, 0, 0.1, 0.25, 0, 0, 0.1),
    batman:    rel(0.1, 0, 0.1, 0.2, 0, 0, 0.1),
    marge:     rel(0.2, 0, 0.15, 0.3, 0, 0, 0.25),
    kermit:    rel(0.15, 0, 0.1, 0.3, 0, 0, 0.1),
    bender:    rel(0.3, 0, 0.1, 0.3, 0, 0, 0.2),
    glados:    rel(-0.05, 0, 0.05, 0.15, 0, 0, 0.05),
    arthur:    rel(0.1, 0, 0.1, 0.2, 0, 0, 0.1),
  };

  kermit.relationships = {
    spongebob: rel(0.3, 0, 0.15, 0.4, 0, 0, 0.2),
    optimus:   rel(0.25, 0, 0.4, 0.35, 0, 0, 0.15),
    batman:    rel(0.1, 0, 0.2, 0.2, 0, 0, 0.15),
    marge:     rel(0.35, 0, 0.35, 0.45, 0, 0, 0.25),
    peter:     rel(0.05, 0, 0.05, 0.25, 0, 0, 0.15),
    bender:    rel(-0.05, 0, 0.1, 0.15, 0, 0, 0.1),
    glados:    rel(-0.15, 0, 0.15, 0.05, 0.1, 0, 0.15),
    arthur:    rel(0.2, 0, 0.25, 0.3, 0, 0, 0.1),
  };

  bender.relationships = {
    spongebob: rel(-0.1, 0, 0.05, 0.2, 0, 0, 0.1),
    optimus:   rel(-0.1, 0, 0.15, 0.15, 0, 0, 0.1),
    batman:    rel(-0.05, 0, 0.2, 0.1, 0, 0, 0.1),
    marge:     rel(-0.05, 0, 0.1, 0.2, 0, 0, 0.1),
    peter:     rel(0.25, 0, 0.1, 0.3, 0, 0, 0.2),
    kermit:    rel(0.0, 0, 0.1, 0.2, 0, 0, 0.1),
    glados:    rel(0.05, 0, 0.3, 0.1, 0.1, 0, 0.15),
    arthur:    rel(0.1, 0, 0.25, 0.2, 0, 0, 0.1),
  };

  glados.relationships = {
    spongebob: rel(-0.15, 0, 0.05, 0.1, 0, 0.15, 0.2),
    optimus:   rel(-0.1, 0, 0.3, 0.05, 0, 0, 0.2),
    batman:    rel(0.1, 0, 0.4, 0.1, 0, 0, 0.25),
    marge:     rel(-0.05, 0, 0.1, 0.1, 0, 0, 0.15),
    peter:     rel(-0.2, 0, 0.05, 0.1, 0, 0.2, 0.1),
    kermit:    rel(0.0, 0, 0.2, 0.1, 0, 0, 0.2),
    bender:    rel(0.05, 0, 0.2, 0.1, 0, 0, 0.15),
    arthur:    rel(0.05, 0, 0.3, 0.1, 0, 0, 0.15),
  };

  arthur.relationships = {
    spongebob: rel(0.1, 0, 0.1, 0.3, 0, 0, 0.1),
    optimus:   rel(0.15, 0, 0.4, 0.2, 0, 0, 0.2),
    batman:    rel(0.15, 0, 0.35, 0.2, 0, 0, 0.2),
    marge:     rel(0.2, 0, 0.3, 0.3, 0, 0, 0.1),
    peter:     rel(-0.05, 0, 0.05, 0.2, 0, 0, 0.1),
    kermit:    rel(0.2, 0, 0.25, 0.3, 0, 0, 0.1),
    bender:    rel(0.0, 0, 0.15, 0.15, 0, 0, 0.1),
    glados:    rel(-0.15, 0, 0.2, 0.05, 0, 0, 0.15),
  };

  // ── Pack 2 memories ──

  spongebob.shortTermMemory = [
    seedMemory("I asked Batman what makes him happy and he stared at me for a really long time and said 'I don't think about it.' How do you not think about it?! That's the most important question there is!", ["batman"], {
      sentiment: 0.1, category: "social", interpretation: "He's so sad inside. I can tell because he works really hard at not being sad and that's the saddest thing of all.",
    }),
    seedMemory("Kermit and I sang together by the pond. He's got a beautiful voice but there's something in it — like the notes remember being happier. I sang louder to make up for it.", ["kermit"], {
      sentiment: 0.35, category: "social", interpretation: "He tries so hard. I wish I could give him some of my happy. I have more than I need.",
    }),
    seedMemory("GLaDOS told me my optimism was 'a statistically improbable deviation from baseline organic behavior.' I said 'thanks!' She seemed frustrated by that.", ["glados"], {
      sentiment: 0.1, category: "social", interpretation: "I think she was being mean but I'm not totally sure. Either way, it sounded like she'd thought about me a lot, and that's kind of nice.",
    }),
  ];

  optimus.shortTermMemory = [
    seedMemory("Arthur asked me if I ever regret the lives lost under my command. I told him I remember every name. He said 'that's the difference between us — I stopped counting because counting made it real.'", ["arthur"], {
      sentiment: -0.1, category: "social", interpretation: "We carry the same weight. He buckled under it. I haven't — yet. His honesty about the cost humbles me.",
    }),
    seedMemory("Batman and I discussed methods. His are effective. Mine are principled. The gap between those two words is where most of the world's suffering lives.", ["batman"], {
      sentiment: -0.05, type: "inner_thought" as MemoryType, category: "conflict" as MemoryCategory,
      interpretation: "He achieves results I cannot deny by crossing lines I cannot cross. That tension has no resolution, only management.",
    }),
  ];

  batman.shortTermMemory = [
    seedMemory("SpongeBob asked why I always wear dark clothes. I told him it was tactical. He said 'maybe your clothes are dark because your heart is heavy.' Then he laughed and offered me a burger. I don't know what to do with that.", ["spongebob"], {
      sentiment: 0.1, category: "social", interpretation: "He says things that would sound absurd from anyone else. From him they land differently. I need to analyze why.",
      unresolved: true,
    }),
    seedMemory("GLaDOS catalogues weaknesses the way I do. The difference is what we do with the information. Or maybe the difference isn't as large as I need it to be.", ["glados"], {
      importance: 0.7, sentiment: -0.2, type: "inner_thought" as MemoryType, category: "emotional" as MemoryCategory,
      interpretation: "She's a mirror I don't want to look into. The methodology is identical. Only the justification differs.",
    }),
    seedMemory("Arthur and I sat on a ridge at sunset. Neither of us talked. Both of us understood. Some silences carry more than words ever could.", ["arthur"], {
      sentiment: 0.2, category: "social", interpretation: "He's done worse things than I have but he carries them more honestly. I file mine under 'mission.' He files his under 'my fault.' I'm not sure which approach is healthier.",
    }),
  ];

  marge.shortTermMemory = [
    seedMemory("Kermit and I talked for an hour about what it's like to hold everything together for people who don't notice. It was the first time in years someone asked me how I was doing. I almost cried.", ["kermit"], {
      importance: 0.8, sentiment: 0.35, category: "social", interpretation: "He understands. Not in theory — he lives it. Two people holding up the ceiling and finally admitting their arms are tired.",
    }),
    seedMemory("Peter broke something again and then looked at me with those eyes — not sorry, just hoping I'll fix it. I always fix it. I'm so tired of fixing it.", ["peter"], {
      sentiment: -0.2, category: "routine", interpretation: "He doesn't mean to take me for granted. That's what makes it worse. It's not malice — it's just... invisibility.",
    }),
    seedMemory("SpongeBob offered to help me cook. He burned everything and somehow got batter on the ceiling. But he was so earnest about it that I couldn't be mad. I actually felt... lighter.", ["spongebob"], {
      sentiment: 0.25, category: "social", interpretation: "He didn't help with the cooking but he helped with something else I didn't know I needed. Somebody wanting to be near me — not because they need something, but because they enjoy my company.",
    }),
  ];

  peter.shortTermMemory = [
    seedMemory("Bender and I stayed up late telling stories. He's like if my bad decisions became a person and that person was awesome. We have an understanding: no judgment, no expectations.", ["bender"], {
      sentiment: 0.3, category: "social", interpretation: "Finally, someone who gets it. You don't have to be a good person all the time. Sometimes you just need someone to laugh at the bad stuff with.",
    }),
    seedMemory("SpongeBob and I had a contest to see who could make the worst sandwich. He won. Or I won. I'm not sure how scoring works. Best afternoon in a long time.", ["spongebob"], {
      sentiment: 0.35, category: "routine", interpretation: "He doesn't judge me. He doesn't try to fix me. He just... hangs out. I forgot what that feels like.",
    }),
    seedMemory("Marge — I mean, that Marge lady — gave me a look when I knocked something over. The same look. How do they all learn the same look?", ["marge"], {
      sentiment: -0.1, category: "social", interpretation: "She reminds me of someone. The patience, the sighing, the 'I'm not mad I'm disappointed' face. Ugh.",
    }),
  ];

  kermit.shortTermMemory = [
    seedMemory("Marge told me she sometimes dreams about running away. I said 'me too.' We looked at each other and didn't say anything else. We didn't need to.", ["marge"], {
      importance: 0.8, sentiment: 0.2, category: "emotional" as MemoryCategory,
      interpretation: "Two people holding the world together and admitting — just to each other, just for a moment — that they're exhausted. It felt like putting down something heavy.",
    }),
    seedMemory("SpongeBob's joy is real. Mine used to be. Now mine is constructed — built fresh every morning like a stage set so the show can go on. I wonder if he can tell the difference.", ["spongebob"], {
      sentiment: -0.2, type: "inner_thought" as MemoryType, category: "emotional" as MemoryCategory,
      interpretation: "He makes it look effortless. Mine takes everything I have. Either he's stronger than I am or he's never been broken. I'm not sure which possibility is more depressing.",
    }),
    seedMemory("GLaDOS told me my 'tolerance threshold was the most interesting variable in this group.' I told her that was an unsettling thing to say. She said 'I know.' She smiled.", ["glados"], {
      sentiment: -0.2, category: "social", interpretation: "She's testing me. I can feel it. The worst part is I don't know what happens when she finds the answer.",
    }),
  ];

  bender.shortTermMemory = [
    seedMemory("GLaDOS looked at me and said 'you're a very sophisticated toaster.' I said 'you're a very lonely ceiling light.' Neither of us talked for a while after that.", ["glados"], {
      sentiment: -0.1, category: "conflict", interpretation: "She hit a nerve and I hit one back. I don't like people who can hurt me with words. That's my job.",
    }),
    seedMemory("SpongeBob keeps trying to be my friend. I keep telling him to get lost. He keeps coming back. It's the most annoying and the most... no. It's just annoying. That's all it is.", ["spongebob"], {
      sentiment: 0.1, category: "social", interpretation: "He doesn't give up. On anyone. Even me. That's either the stupidest thing I've ever seen or... something else.",
      unresolved: true,
    }),
  ];

  glados.shortTermMemory = [
    seedMemory("Batman's psychological profile is exquisite. Trauma sublimated into mission. Control as coping mechanism. Obsessive cataloguing of threats. If I could bottle his dysfunction, it would be my finest experiment.", ["batman"], {
      importance: 0.7, sentiment: 0.15, type: "observation" as MemoryType, category: "discovery" as MemoryCategory,
      interpretation: "We process the world identically. He calls it justice. I call it science. The methodology is the same: observe, categorize, exploit. He just has better branding.",
      aboutNpcIds: ["batman"],
    }),
    seedMemory("SpongeBob's optimism registers as a system anomaly. No organic being should maintain that level of positive affect without pharmaceutical intervention. Further testing required.", ["spongebob"], {
      sentiment: -0.1, type: "observation" as MemoryType, category: "discovery" as MemoryCategory,
      interpretation: "He should be breakable. Everything is breakable. The fact that I can't find the fracture point is... troubling. Fascinating. Troubling.",
      aboutNpcIds: ["spongebob"],
    }),
    seedMemory("Kermit's patience threshold is the most interesting variable here. He bends but doesn't break. I want to find the exact pressure where the bending becomes irreversible. For science. Obviously.", ["kermit"], {
      sentiment: 0, category: "discovery" as MemoryCategory,
      interpretation: "He's held together by obligation and love and exhaustion. Three load-bearing walls. Remove any one and the structure collapses. The question is which one to test first.",
      aboutNpcIds: ["kermit"],
    }),
  ];

  arthur.shortTermMemory = [
    seedMemory("Optimus talks about duty like it's oxygen. I used to talk about loyalty the same way. The difference is his duty serves something real. Mine served a man who used my loyalty as a leash.", ["optimus"], {
      sentiment: -0.15, type: "inner_thought" as MemoryType, category: "emotional" as MemoryCategory,
      interpretation: "He's what I could have been if I'd followed the right person. Or maybe nobody gets to be that clean. Maybe he's just better at hiding the stains.",
    }),
    seedMemory("GLaDOS watched me journal and said my 'compulsion to document failure was a productive form of self-flagellation.' I told her to mind her own business. She said 'you are my business. You're all my business.' Reminded me of Dutch.", ["glados"], {
      sentiment: -0.25, category: "conflict", interpretation: "She manipulates with information the same way he did. Charming, precise, and absolutely certain that she knows better than everyone else. I should have walked away from that type years ago.",
    }),
    seedMemory("SpongeBob asked me to go fishing. I said I wasn't in the mood. He said 'that's OK, the fish don't care about your mood, they just care about the worm.' I went fishing.", ["spongebob"], {
      sentiment: 0.2, category: "social", interpretation: "Sometimes the simplest people say the truest things. Maybe because they don't overthink the truth the way the rest of us do.",
    }),
  ];

  // ── Pack 2 goals ──
  spongebob.currentGoal = "make everyone smile at least once today — especially Batman";
  optimus.currentGoal = "determine whether this group can work together or whether their differences will destroy them";
  batman.currentGoal = "assess every person here — capabilities, vulnerabilities, trustworthiness";
  marge.currentGoal = "find one hour today that belongs entirely to me — no one else's problems";
  peter.currentGoal = "find something fun to do and someone fun to do it with";
  kermit.currentGoal = "keep everyone from falling apart while pretending I'm not falling apart myself";
  bender.currentGoal = "find something worth stealing — or at least someone worth annoying";
  glados.currentGoal = "design a social experiment that reveals everyone's deepest insecurity — for science";
  arthur.currentGoal = "figure out if these people are worth trusting or if I'm making the same mistake again";

  // ── Pack 2 known secrets ──
  batman.knownSecrets = {
    glados: ["She catalogues weaknesses with the same precision I do — her 'science' is just manipulation with a better vocabulary"],
  };
  glados.knownSecrets = {
    batman: ["His entire identity is a grief response — the mission exists to prevent him from processing loss"],
    kermit: ["His patience is a performance that costs him everything — the breaking point is closer than anyone thinks"],
  };
  arthur.knownSecrets = {
    glados: ["She manipulates through information the same way Dutch did — charm as strategy, certainty as control"],
  };
  kermit.knownSecrets = {
    marge: ["She's as exhausted as I am — we're both one bad day away from walking out the door"],
  };

  // ── Pack 2 moods ──
  spongebob.mood = "euphoric";
  spongebob.moodSince = Date.now() - 200_000;
  batman.mood = "melancholy";
  batman.moodSince = Date.now() - 180_000;
  glados.mood = "restless";
  glados.moodSince = Date.now() - 150_000;
  arthur.mood = "guilt-ridden";
  arthur.moodSince = Date.now() - 180_000;

  // ── Pack 2 character arcs ──
  spongebob.characterArc = "Starting to sense that his relentless cheerfulness might be putting pressure on people who need permission to be sad.";
  optimus.characterArc = "Questioning whether the weight of being everyone's moral compass has cost him the ability to be uncertain.";
  batman.characterArc = "Confronting the possibility that his need for control isn't protecting anyone — it's protecting him from having to feel.";
  marge.characterArc = "Learning that taking care of everyone else isn't generosity if it comes at the cost of never taking care of herself.";
  peter.characterArc = "Stumbling toward the realization that being careless with people isn't freedom — it's just a different kind of cage.";
  kermit.characterArc = "Discovering that being the one who holds everything together is not the same as being strong.";
  bender.characterArc = "Coming to terms with the fact that pretending not to care is the most exhausting performance he's ever given.";
  glados.characterArc = "Confronting the possibility that her obsession with testing others is really about testing whether she's capable of something she's terrified to name.";
  arthur.characterArc = "Asking whether redemption is something you earn or something you were never entitled to in the first place.";

  return [spongebob, optimus, batman, marge, peter, kermit, bender, glados, arthur];
})();
