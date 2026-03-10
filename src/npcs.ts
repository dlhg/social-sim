import type { NPC, EmotionalState, InventoryItem, ItemCategory } from "./types";
import { ITEM_LIFETIME_BY_CATEGORY } from "./types";

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
  avatar: string;
  color: string;
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
    avatar: pick(AVATAR_OPTIONS),
    color: pick(COLOR_SWATCHES),
    traits,
    desires,
    secrets,
    backstory: generateBackstory(name, traits, desires, secrets),
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
  const backstory = generateBackstory(name, personalityTraits, coreDesires, secrets);

  const inventory = randomizeInventory();
  return createNpc({ id, name, avatar, color, personalityTraits, coreDesires, backstory, secrets, inventory });
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
  backstory?: string;
  emotionalState?: Partial<EmotionalState>;
  secrets?: string[];
  inventory?: InventoryItem[];
  customVoiceId?: string;
}): NPC {
  return {
    ...partial,
    backstory: partial.backstory,
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
    customVoiceId: partial.customVoiceId,
    characterArc: undefined,
    mood: undefined,
    moodSince: undefined,
  };
}

// ── Relationship constructor helper ──
function rel(
  regard: number, affection = 0, respect = 0.3, trust = 0.3,
  fear = 0, debt = 0, familiarity = 0.1,
): import("./types").RelationshipState {
  return { regard, affection, respect, trust, fear, debt, familiarity };
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
    emotionalState: { anger: 0.6, trust: 0.2, joy: 0.3, curiosity: 0.5, disgust: 0.2 },
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

  // ── Seed relationships ──
  // Alice: likes Bob (intellectual kinship), finds Victor abrasive, trusts Mara (hasn't seen through her), worried about Ellis
  alice.relationships = {
    bob:    rel(0.35, 0, 0.4, 0.45, 0, 0, 0.4),
    victor: rel(-0.15, 0, 0.25, 0.15, 0.15, 0, 0.35),
    mara:   rel(0.2, 0, 0.3, 0.35, 0, 0, 0.25),
    ellis:  rel(0.1, 0, 0.3, 0.3, 0, 0, 0.15),
  };

  // Bob: enjoys Alice's energy, suspicious of Mara, gentle with Ellis, respects Victor's mind grudgingly
  bob.relationships = {
    alice:  rel(0.3, 0, 0.45, 0.4, 0, 0, 0.4),
    victor: rel(-0.1, 0, 0.4, 0.2, 0, 0, 0.3),
    mara:   rel(-0.1, 0, 0.25, 0.15, 0, 0, 0.3),
    ellis:  rel(0.15, 0, 0.3, 0.35, 0, 0, 0.2),
  };

  // Victor: secretly admires Alice (high respect, hidden affection), sees Bob as sparring partner, distrusts Mara, impatient with Ellis
  victor.relationships = {
    alice:  rel(0.25, 0.15, 0.6, 0.2, 0, 0, 0.45),
    bob:    rel(0.05, 0, 0.4, 0.25, 0, 0, 0.3),
    mara:   rel(-0.15, 0, 0.2, 0.1, 0, 0, 0.25),
    ellis:  rel(-0.2, 0, 0.1, 0.15, 0, 0, 0.15),
  };

  // Mara: has studied everyone (high familiarity), targets Ellis (vulnerability), intrigued by Bob (can't read him), views Alice as easy
  mara.relationships = {
    alice:  rel(0.2, 0, 0.3, 0.3, 0, 0, 0.5),
    bob:    rel(0.1, 0, 0.35, 0.2, 0, 0, 0.45),
    victor: rel(-0.1, 0, 0.3, 0.1, 0.2, 0, 0.5),
    ellis:  rel(0.2, 0, 0.2, 0.25, 0, 0, 0.55),
  };

  // Ellis: Bob feels safest, Mara feels wrong, Alice is overwhelming, Victor is terrifying
  ellis.relationships = {
    alice:  rel(0.05, 0, 0.3, 0.25, 0, 0, 0.2),
    bob:    rel(0.15, 0, 0.35, 0.4, 0, 0, 0.25),
    victor: rel(-0.25, 0, 0.2, 0.1, 0.4, 0, 0.2),
    mara:   rel(-0.2, 0, 0.25, 0.1, 0.3, 0, 0.3),
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
  // Mara has picked up hints about Alice's guilt (not the exact secret, but she senses it)
  // Ellis overheard Victor's university rejection mentioned in passing
  ellis.knownSecrets = {
    victor: ["He was rejected from his dream university"],
  };

  return [alice, bob, victor, mara, ellis];
})();
