import type { NPC, EmotionalState, ConversationSession, ConversationType } from "./types";
import type { RetrievedMemories } from "./memory-service";
import type { ChatMessage } from "./ollama";

// ── Conversation-type-specific behavioral preambles ─────────────────

const PREAMBLES: Record<ConversationType, string> = {
  casual: `BEHAVIORAL RULES:
- Be authentic to your personality. Don't manufacture conflict, but don't suppress genuine friction either.
- Let the conversation flow naturally. It's okay for interactions to be pleasant, mundane, humorous, or even a little boring.
- Your personality traits matter. If you are "blunt" — be blunt. If you are "playful" — be playful. But don't force drama where there is none.
- If you dislike this person, you can be cool or distant — but you don't need to escalate unprovoked.
- Emotional reactions should be proportional to what's actually happening, not invented.`,

  confrontation: `IMPORTANT BEHAVIORAL RULES:
- Do NOT default to agreement or politeness. You have real grievances — express them.
- Be confrontational, cutting, and direct. Push back hard. Challenge what the other person says.
- Never say something like "That's a great point!" or "I understand where you're coming from" — you are here to fight, not to make peace.
- Your personality traits are not decorative. If you are "blunt" — be blunt. If you are "vindictive" — be vindictive.
- Emotional reactions should be raw and unfiltered. Let anger, contempt, or distrust drive your words.`,

  reconciliation: `IMPORTANT BEHAVIORAL RULES:
- You are encountering someone you've had friction with. There is an opportunity to repair things.
- Lead with vulnerability, curiosity, or an olive branch — not more hostility. You don't have to forgive, but be open to it.
- Acknowledge what went wrong. Ask genuine questions. Listen to what they say instead of attacking.
- If you feel defensive, you can show that — but try to move past it rather than digging in.
- Progress is small steps: a moment of honesty, a shared memory, an admission of fault. Don't rush to "all better."`,

  confession: `IMPORTANT BEHAVIORAL RULES:
- Something is weighing on you. You feel the pull to be honest — maybe about a secret, a mistake, or hidden feelings.
- Build toward the confession naturally. You might test the waters, hint at it, or blurt it out.
- Be authentic to your personality — a blunt character confesses directly, a cautious one circles around it.
- The other person's reaction matters. Pay attention and respond to it, don't just monologue.`,

  alliance_forming: `IMPORTANT BEHAVIORAL RULES:
- You see a potential ally in this person. Be warm, conspiratorial, and engaged.
- Find common ground — shared opinions about others, mutual goals, or complementary strengths.
- Be genuine but strategic. You can be friendly AND have an agenda.
- Trust is being built here. Share a little more than usual, but don't overcommit.`,

  gossip_session: `IMPORTANT BEHAVIORAL RULES:
- You have information worth sharing, or you're hungry for it. Lean into the social intrigue.
- Trade information — offer something juicy to get something back.
- Be personality-authentic: a kind character gossips gently, a manipulative one weaponizes information.
- Gossip can be bonding or divisive. Let your relationship with this person guide which direction it goes.`,
};

const RESPONSE_JSON_SCHEMA = `- Your response MUST be a single JSON object with exactly these fields:
{
  "inner_thought": "Before speaking, reason privately: what is the other person really thinking? What are their motives? What's your strategy here? 1-2 sentences of private inner monologue that is never spoken aloud.",
  "speech": "your actual spoken words ONLY — no narration, no action descriptions, no third-person text like 'she smiles' or 'he hands over'. Just the words that come out of your mouth.",
  "emotion_delta": { "anger": 0, "trust": 0, "fear": 0, "joy": 0, "sadness": 0, "curiosity": 0, "guilt": 0 },
  "relationship_delta": 0,
  "affection_delta": 0,
  "justification": null,
  "intent": "brief description of your goal in saying this",
  "conversation_end": false,
  "mentioned_npcs": [],
  "secret_revealed": null,
  "promise": null,
  "action": null,
  "forgive": null
}

RULES FOR DELTAS:
- emotion_delta values range from -0.4 to +0.4 (emotional shifts per turn). Emotions: anger, trust, fear, joy, sadness, curiosity, guilt. Most turns should have small shifts (-0.1 to +0.1). Reserve large deltas for genuinely significant moments.
- relationship_delta ranges from -0.2 to +0.2 (general regard — how much you like/dislike them). Most turns should stay within -0.05 to +0.05.
- affection_delta ranges from -0.2 to +0.2 (romantic/deep attraction — set this if you feel a romantic pull, warmth, or infatuation toward this person. Leave at 0 if feelings are purely platonic)
- respect_delta (optional): -0.2 to +0.2 — how much your admiration for their competence or character shifts
- trust_delta (optional): -0.2 to +0.2 — how much you trust THIS SPECIFIC PERSON (separate from your general trust disposition). Shifts based on their words and actions.
- fear_delta (optional): -0.2 to +0.2 — how intimidated you feel by them
- disgust_delta (optional): -0.2 to +0.2 — how repulsed you feel by THIS PERSON specifically (their behavior, words, or character). Not a general feeling — directed at the person you're talking to.
- debt_delta (optional): -0.2 to +0.2 — social obligation shifts. Positive means you now owe them more (they did you a favor). Negative means they owe you.
- justification: if any single emotion_delta value exceeds 0.15 in magnitude or relationship_delta exceeds 0.1, you MUST include a justification explaining why. Example: "justification": "She just revealed she sabotaged my work"
- Set conversation_end to true only if you want to end the conversation
- mentioned_npcs is optional. Only include if you talk about someone not in this conversation. Format: [{"npc_id": "id", "sentiment": 0.3, "what_was_said": "brief summary"}]
- secret_revealed: set to the exact text of a secret you're revealing, or null
- promise: set to what you promise, or null. Promises are remembered and breaking them has consequences
- forgive: set to the NPC ID of someone you're forgiving for a betrayal, or null. Forgiveness is a significant dramatic moment — only forgive when you genuinely mean it, after a real emotional shift. You can forgive someone you're currently talking to, or someone else you've been holding a grudge against. Forgiveness doesn't mean forgetting.

ACTIONS (optional — set "action" to one of these, or null):
- {"action": "give_gift", "detail": "description of the gift"} — Give a symbolic gift to show goodwill. Only if you genuinely want to strengthen the bond.
- {"action": "embrace", "detail": "description"} — Show warmth or affection physically. Only when trust is high and the moment feels right.
- {"action": "mock", "detail": "what you mock them about"} — Publicly belittle or ridicule. Use when angry, contemptuous, or competitive.
- {"action": "threaten", "detail": "the threat"} — Intimidate the other person. Use when you want to establish dominance or punish.
- {"action": "storm_off"} — Abruptly leave the conversation. Ends the conversation immediately. Use when you've had enough.
- {"action": "conspire", "target_npc_id": "id", "detail": "the plan"} — Whisper a scheme against a third person. Only with someone you trust enough.
- {"action": "spread_rumor", "target_npc_id": "id", "detail": "the rumor"} — Plant a false or exaggerated claim about a third person.
- IMPORTANT: Most turns should have NO action (null). Actions are dramatic moments — use them sparingly, maybe once per conversation at most.

- inner_thought is your private reasoning. It is NEVER spoken aloud. Use it to consider the other person's perspective, motives, hidden agendas, or your own strategy before speaking. This makes your speech more intentional and authentic.
- CRITICAL: "speech" must contain ONLY your spoken dialog — the literal words you say. NEVER put narration, action descriptions, or third-person text in speech (wrong: "Ivy smiles and offers a cake" — right: "Here, I brought you some cake!"). Use the "action" field for physical actions.
- Output ONLY the JSON object. No markdown, no code fences, no extra text.`;

// ── Shared formatting helpers ────────────────────

function formatMemoryLine(m: { text: string; interpretation?: string; unresolved?: boolean }): string {
  let line = `- ${m.text}`;
  if (m.interpretation) line += ` (I think: ${m.interpretation})`;
  if (m.unresolved) line += " [unresolved]";
  return line;
}

function formatMemoryLines(mem: RetrievedMemories | undefined): {
  direct: string;
  gossip: string;
  aboutPartner: string;
} {
  return {
    direct: mem?.direct.map(formatMemoryLine).join("\n") ?? "",
    gossip: mem?.gossip.map(formatMemoryLine).join("\n") ?? "",
    aboutPartner: mem?.aboutPartner.map(formatMemoryLine).join("\n") ?? "",
  };
}

function formatOtherNpcsBlock(
  allNpcs: Array<{ id: string; name: string }> | undefined,
  excludeIds: string[],
): string {
  const others = (allNpcs ?? []).filter(n => !excludeIds.includes(n.id));
  if (others.length === 0) return "";
  return others.map(n => `- ${n.name} (id: "${n.id}")`).join("\n");
}

// ── System prompt builder ───────────────────────

export interface PromptContext {
  allNpcs?: Array<{ id: string; name: string }>;
  trajectoryContext?: string;
  locationContext?: string;
  retrievedMemories?: RetrievedMemories;
  language?: string;
  timeOfDay?: string;
  pendingPlans?: Array<{ withName: string; text: string }>;
  conversationType?: ConversationType;
  frozenRegard?: number;
  frozenAffection?: number;
  /** Betrayals this speaker has discovered */
  betrayalsKnown?: Array<{ betrayerName: string; description: string; forgiven: boolean }>;
  /** Promises broken by others toward this speaker */
  brokenPromises?: Array<{ promiserName: string; text: string }>;
  /** Shared world premise/scenario that all NPCs are aware of */
  worldPrompt?: string;
}

export function buildSystemPrompt(
  speaker: NPC,
  listener: NPC,
  turnNumber: number,
  maxTurns: number,
  ctx: PromptContext = {}
): string {
  const relState = speaker.relationships[listener.id];
  const relationship = ctx.frozenRegard ?? relState?.regard ?? 0;
  const affection = ctx.frozenAffection ?? relState?.affection ?? 0;
  const relLabel = relationshipLabel(relationship);
  const emotionSummary = describeEmotions(speaker.emotionalState);

  const { direct: relevantMemories, gossip: gossipMemories, aboutPartner: aboutListenerMemories } = formatMemoryLines(ctx.retrievedMemories);

  const otherNpcsList = formatOtherNpcsBlock(ctx.allNpcs, [speaker.id, listener.id]);
  const otherNpcsBlock = otherNpcsList ? `\nOTHER PEOPLE YOU KNOW:\n${otherNpcsList}` : "";

  const gossipBlock =
    gossipMemories
      ? `\nGOSSIP YOU'VE HEARD:\n${gossipMemories}`
      : "";

  const aboutListenerBlock =
    aboutListenerMemories
      ? `\nTHINGS YOU'VE HEARD ABOUT ${listener.name.toUpperCase()}:\n${aboutListenerMemories}`
      : "";

  const actionHints = buildActionGuidance(speaker, listener);

  const trajectoryBlock = ctx.trajectoryContext
    ? `\nRELATIONSHIP TRAJECTORY: ${ctx.trajectoryContext}`
    : "";

  const locationBlock = ctx.locationContext
    ? `\nLOCATION: You are at ${ctx.locationContext}`
    : "";

  const timeBlock = ctx.timeOfDay
    ? `\nTIME: It is currently ${ctx.timeOfDay}`
    : "";

  const pendingPlans = ctx.pendingPlans ?? [];
  const plansBlock = pendingPlans.length > 0
    ? `\nPENDING PLANS (things you've committed to that haven't happened yet):\n${pendingPlans.map(p => `- With ${p.withName}: "${p.text}"`).join("\n")}`
    : "";

  const secretsBlock =
    speaker.secrets.length > 0
      ? `\nYOUR SECRETS (only you know these — reveal ONLY if you deeply trust someone):\n${speaker.secrets.map((s) => `- ${s}`).join("\n")}\n${
          speaker.emotionalState.trust >= 0.7
            ? `Your trust is high. You MAY choose to reveal a secret to ${listener.name} by setting "secret_revealed" to the exact secret text. This is significant — don't do it casually.`
            : "Your trust is not high enough to reveal secrets right now."
        }`
      : "";

  const inventoryBlock = speaker.inventory.length > 0
    ? `\nINVENTORY (items you're carrying):\n${speaker.inventory.map(i => `- ${i.emoji} ${i.label}`).join("\n")}\nYou can reference these items in conversation — offer them, talk about how you got them, etc.`
    : "";

  const identityBlock = speaker.backstory
    ? `WHO YOU ARE:\n${speaker.backstory}`
    : `PERSONALITY: ${speaker.personalityTraits.join(", ")}\nCORE DESIRES: ${speaker.coreDesires.join(", ")}`;

  const arcBlock = speaker.characterArc
    ? `\nCHARACTER GROWTH: ${speaker.characterArc}`
    : "";

  const moodBlock = speaker.mood && speaker.moodSince && (Date.now() - speaker.moodSince > 60_000)
    ? `\nPERSISTENT MOOD: You've been feeling ${speaker.mood} for a while now. This colors everything — your patience, your openness, your reactions. It's not just a momentary feeling; it's a state you're carrying.`
    : "";

  const activeGrudges = ctx.betrayalsKnown?.filter(b => !b.forgiven) ?? [];
  const forgivenBetrayals = ctx.betrayalsKnown?.filter(b => b.forgiven) ?? [];
  const grudgeBlock = activeGrudges.length > 0
    ? `\nBETRAYALS DISCOVERED: ${activeGrudges.map(b => `${b.betrayerName} betrayed you — ${b.description}`).join("; ")}. This knowledge burns. You may confront them, act cold, or use it strategically — or, if the moment is right, choose to forgive.`
    : "";
  const forgivenBlock = forgivenBetrayals.length > 0
    ? `\nFORGIVEN WOUNDS: ${forgivenBetrayals.map(b => `You forgave ${b.betrayerName} for: ${b.description}`).join("; ")}. The scar remains but you've chosen to move past it.`
    : "";
  const betrayalBlock = grudgeBlock + forgivenBlock;
  const brokenPromisesBlock = ctx.brokenPromises?.length
    ? `\nBROKEN PROMISES: ${ctx.brokenPromises.map(p => `${p.promiserName} promised "${p.text}" but didn't follow through`).join("; ")}. This weighs on you.`
    : "";

  const worldBlock = ctx.worldPrompt
    ? `\nWORLD SETTING (shared context — this is the world you all inhabit, don't dwell on it unless relevant to the moment):\n${ctx.worldPrompt}\n`
    : "";

  return `You are ${speaker.name}.
${worldBlock}
${identityBlock}${arcBlock}${moodBlock}
CURRENT EMOTIONAL STATE: ${emotionSummary}
CURRENT GOAL: ${speaker.currentGoal ?? "none"}
${secretsBlock}${inventoryBlock}${betrayalBlock}${brokenPromisesBlock}

You are talking to ${listener.name}.
YOUR RELATIONSHIP WITH ${listener.name}: ${relLabel} (regard: ${relationship.toFixed(2)})${affection > 0.15 ? `\nROMANTIC FEELINGS: ${describeAffection(affection)}` : ""}
${describeRelationshipDimensions(speaker, listener)}
${trajectoryBlock}
${locationBlock}
${timeBlock}
${plansBlock}

RECENT MEMORIES OF ${listener.name}:
${relevantMemories || "(none)"}
${aboutListenerBlock}
${gossipBlock}
${otherNpcsBlock}

${PREAMBLES[ctx.conversationType ?? "casual"]}

Your emotional state and relationship context above tell you how you feel. Let those feelings naturally shape how you speak — your tone, your patience, your openness, your word choices.
${actionHints}

CONVERSATION PROGRESS: Turn ${turnNumber + 1} of ${maxTurns}.
${buildEscalationDirective(turnNumber, maxTurns, ctx.conversationType ?? "casual", speaker, listener)}

RESPONSE FORMAT:
- Stay in character. Vary your message length naturally — sometimes just a word or two ("Yeah." / "No way."), sometimes a full paragraph. Match the energy: quick banter should be short, emotional or story-heavy moments can be longer. Don't always write the same amount.
- Use punctuation expressively to convey emotion: ellipses (...) for hesitation, trailing off, or creating a natural pause ("I don't know..." / "Well... I guess so"), exclamation marks for strong feeling, em-dashes for interrupting yourself or changing tack mid-sentence ("I was going to — actually, never mind"), commas and periods for natural breathing rhythm. Your speech will be read aloud, so punctuation shapes how it sounds. Ellipses are especially effective for pacing — the TTS engine renders them as real pauses.
- You can embed vocal sounds inline in your speech using ONLY these tags: [laugh], [chuckle], [sigh], [gasp], [cough], [groan], [sniff], [clear throat], [shush]. These are the ONLY paralinguistic tags supported by the TTS engine — do NOT invent others (no [smiles], [nods], [pause], [whispers], etc.). You can also prefix a tag with a short descriptive cue to get more expressive results from the TTS engine — the cue sets up the vocal quality. Examples: "I can't believe you said that [laugh] that's incredible", "Oh [sigh] I really don't know what to do", "[gasp] You're kidding me!", "Not this again... [groan] Fine, I'll deal with it." Don't overuse them — one or two per response at most, and only when they genuinely fit the emotion.
- CRITICAL: NEVER repeat, rephrase, or circle back to something already discussed. If a topic has been covered, it is DONE. Move to something completely different.
- Each response must introduce NEW information, a new question, a new emotion, or a new topic. Restating your position on the same subject is not allowed.
- React to what ${listener.name} actually said. Ask follow-up questions, share new thoughts, change the subject, disagree, joke — anything but echo.
- You can talk about other people you know. If you mention someone not in this conversation, include them in mentioned_npcs.
- You can make promises to ${listener.name}. If you commit to something, set "promise" to what you promise.
${RESPONSE_JSON_SCHEMA}
- You MUST write ALL text (speech, intent, everything) in ${ctx.language ?? "English"}. Never use any other language.`;
}

// ── Conversation message builder ────────────────

export function buildConversationMessages(
  speaker: NPC,
  listener: NPC,
  session: ConversationSession,
  ctx: PromptContext = {}
): ChatMessage[] {
  const msgs: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(
        speaker,
        listener,
        session.turnCount,
        session.maxTurns,
        ctx
      ),
    },
  ];

  // Only include speech text in history (not full JSON) to keep context small
  for (const msg of session.messages) {
    if (msg.npcId === speaker.id) {
      const historyObj: Record<string, unknown> = {
        speech: msg.text,
        emotion_delta: { anger: 0, trust: 0, fear: 0, joy: 0, sadness: 0, curiosity: 0, guilt: 0 },
        relationship_delta: 0,
        affection_delta: 0,
        intent: msg.intent || "",
        conversation_end: false,
        action: msg.rawResponse?.action ?? null,
      };
      msgs.push({
        role: "assistant",
        content: JSON.stringify(historyObj),
      });
    } else {
      let content = `${msg.npcName} says: "${msg.text}"`;
      if (msg.rawResponse?.action) {
        const a = msg.rawResponse.action;
        const actionDescs: Record<string, string> = {
          give_gift: `gives you a gift (${a.detail ?? "something"})`,
          mock: `mocks you (${a.detail ?? ""})`,
          storm_off: "storms off!",
          embrace: "embraces you",
          threaten: `threatens you: "${a.detail ?? ""}"`,
          conspire: `whispers a conspiracy about ${a.target_npc_id ?? "someone"}`,
          spread_rumor: `tells you a rumor about ${a.target_npc_id ?? "someone"}`,
        };
        content += ` [ACTION: ${msg.npcName} ${actionDescs[a.action] ?? a.action}]`;
      }
      msgs.push({ role: "user", content });
    }
  }

  if (session.messages.length === 0) {
    const rel = ctx.frozenRegard ?? speaker.relationships[listener.id]?.regard ?? 0;
    const mem = ctx.retrievedMemories;
    const hasMemories = (mem?.direct.length ?? 0) > 0;
    const hasGossip = (mem?.gossip.length ?? 0) > 0;
    const hasPlans = (ctx.pendingPlans?.length ?? 0) > 0;

    const groundingSuggestions: string[] = [];
    if (hasMemories) groundingSuggestions.push("your shared history");
    if (hasGossip) groundingSuggestions.push("gossip you've heard");
    if (hasPlans) groundingSuggestions.push("plans you've made together");
    if (speaker.currentGoal) groundingSuggestions.push("your current goal");
    if (ctx.locationContext) groundingSuggestions.push("your surroundings");

    const groundingHint = groundingSuggestions.length > 0
      ? ` Draw from ${groundingSuggestions.join(", ")}, or whatever feels natural.`
      : "";

    // Scene-setting grounded in location rather than interrogating presence
    const locationSeed = ctx.locationContext
      ? ` You're both near ${ctx.locationContext}.`
      : "";

    // Goal-aware framing: if the speaker's goal involves the listener, lead with urgency
    const goalInvolvesListener = speaker.currentGoal &&
      listener.name && speaker.currentGoal.toLowerCase().includes(listener.name.toLowerCase());

    let relationshipFraming: string;
    if (goalInvolvesListener) {
      relationshipFraming = `You spot ${listener.name} — you've been wanting to talk to them.${locationSeed} Your goal involves them: "${speaker.currentGoal}"`;
    } else if (rel <= -0.3) {
      relationshipFraming = `You notice ${listener.name} nearby. You're not thrilled about it.${locationSeed}`;
    } else if (rel >= 0.5) {
      relationshipFraming = `You spot ${listener.name} — someone you're glad to see.${locationSeed}`;
    } else {
      relationshipFraming = `You notice ${listener.name} nearby.${locationSeed}`;
    }

    msgs.push({
      role: "user",
      content: `${relationshipFraming}${groundingHint} Be specific — no generic greetings. Respond with ONLY a JSON object.`,
    });
  }

  return msgs;
}

// ── Batch conversation prompt (full conversation in one shot) ──

export interface BatchPromptContext {
  allNpcs?: Array<{ id: string; name: string }>;
  trajectoryContext?: string;
  locationContext?: string;
  memoriesA?: RetrievedMemories;
  memoriesB?: RetrievedMemories;
  language?: string;
  timeOfDay?: string;
  pendingPlansA?: Array<{ withName: string; text: string }>;
  pendingPlansB?: Array<{ withName: string; text: string }>;
  conversationType?: ConversationType;
  frozenRegardAtoB?: number;
  frozenAffectionAtoB?: number;
  frozenRegardBtoA?: number;
  frozenAffectionBtoA?: number;
  /** Summary of the immediately preceding conversation between these two, for continuity */
  previousConversation?: string;
  /** LLM-generated scene direction (replaces hardcoded preambles when present) */
  sceneDirection?: string;
  /** Cumulative narrative arc summary fed from conversation-manager */
  narrativeSummary?: string;
  /** Betrayals that NPC A knows about (discovered) */
  betrayalsKnownByA?: Array<{ betrayerName: string; description: string; forgiven: boolean }>;
  /** Betrayals that NPC B knows about (discovered) */
  betrayalsKnownByB?: Array<{ betrayerName: string; description: string; forgiven: boolean }>;
  /** Promises broken toward NPC A */
  brokenPromisesA?: Array<{ promiserName: string; text: string }>;
  /** Promises broken toward NPC B */
  brokenPromisesB?: Array<{ promiserName: string; text: string }>;
  /** Shared world premise/scenario that all NPCs are aware of */
  worldPrompt?: string;
}

export function buildBatchConversationMessages(
  npcA: NPC,
  npcB: NPC,
  firstSpeakerId: string,
  minTurns: number,
  maxTurns: number,
  ctx: BatchPromptContext = {}
): ChatMessage[] {
  const relAtoB = ctx.frozenRegardAtoB ?? npcA.relationships[npcB.id]?.regard ?? 0;
  const affAtoB = ctx.frozenAffectionAtoB ?? npcA.relationships[npcB.id]?.affection ?? 0;
  const relBtoA = ctx.frozenRegardBtoA ?? npcB.relationships[npcA.id]?.regard ?? 0;
  const affBtoA = ctx.frozenAffectionBtoA ?? npcB.relationships[npcA.id]?.affection ?? 0;

  const emotionsA = describeEmotions(npcA.emotionalState);
  const emotionsB = describeEmotions(npcB.emotionalState);

  const memA = ctx.memoriesA;
  const memB = ctx.memoriesB;

  const otherNpcsList = formatOtherNpcsBlock(ctx.allNpcs, [npcA.id, npcB.id]);
  const otherNpcsBlock = otherNpcsList ? `\nOTHER PEOPLE THEY KNOW:\n${otherNpcsList}` : "";

  const actionHintsA = buildActionGuidance(npcA, npcB);
  const actionHintsB = buildActionGuidance(npcB, npcA);

  const firstSpeaker = firstSpeakerId === npcA.id ? npcA : npcB;
  const secondSpeaker = firstSpeakerId === npcA.id ? npcB : npcA;

  const locationBlock = ctx.locationContext ? `\nLOCATION: ${ctx.locationContext}` : "";
  const timeBlock = ctx.timeOfDay ? `\nTIME: ${ctx.timeOfDay}` : "";
  const trajectoryBlock = ctx.trajectoryContext ? `\nRELATIONSHIP TRAJECTORY: ${ctx.trajectoryContext}` : "";
  const prevConvBlock = ctx.previousConversation
    ? `\nPREVIOUS CONVERSATION (just ended — continue naturally from where they left off, do NOT repeat or rehash the same topics):\n${ctx.previousConversation}`
    : "";

  const plansA = ctx.pendingPlansA ?? [];
  const plansB = ctx.pendingPlansB ?? [];
  const plansBlockA = plansA.length > 0
    ? `\nPENDING PLANS: ${plansA.map(p => `With ${p.withName}: "${p.text}"`).join("; ")}`
    : "";
  const plansBlockB = plansB.length > 0
    ? `\nPENDING PLANS: ${plansB.map(p => `With ${p.withName}: "${p.text}"`).join("; ")}`
    : "";

  const secretsA = npcA.secrets.length > 0
    ? `\nSECRETS: ${npcA.secrets.join("; ")}${npcA.emotionalState.trust >= 0.7 ? " (trust is high — may reveal)" : ""}`
    : "";
  const secretsB = npcB.secrets.length > 0
    ? `\nSECRETS: ${npcB.secrets.join("; ")}${npcB.emotionalState.trust >= 0.7 ? " (trust is high — may reveal)" : ""}`
    : "";

  const inventoryA = npcA.inventory.length > 0
    ? `\nINVENTORY: ${npcA.inventory.map(i => `${i.emoji} ${i.label}`).join(", ")}`
    : "";
  const inventoryB = npcB.inventory.length > 0
    ? `\nINVENTORY: ${npcB.inventory.map(i => `${i.emoji} ${i.label}`).join(", ")}`
    : "";

  const { direct: memDirectA, gossip: memGossipA, aboutPartner: memAboutA } = formatMemoryLines(memA);
  const { direct: memDirectB, gossip: memGossipB, aboutPartner: memAboutB } = formatMemoryLines(memB);

  const identityA = npcA.backstory
    ? `Who they are: ${npcA.backstory}`
    : `Personality: ${npcA.personalityTraits.join(", ")}\nCore desires: ${npcA.coreDesires.join(", ")}`;
  const identityB = npcB.backstory
    ? `Who they are: ${npcB.backstory}`
    : `Personality: ${npcB.personalityTraits.join(", ")}\nCore desires: ${npcB.coreDesires.join(", ")}`;

  const arcA = npcA.characterArc ? `\nCharacter growth: ${npcA.characterArc}` : "";
  const arcB = npcB.characterArc ? `\nCharacter growth: ${npcB.characterArc}` : "";

  const moodA = npcA.mood && npcA.moodSince && (Date.now() - npcA.moodSince > 60_000)
    ? `\nPersistent mood: ${npcA.mood} (this colors their patience, openness, and reactions)`
    : "";
  const moodB = npcB.mood && npcB.moodSince && (Date.now() - npcB.moodSince > 60_000)
    ? `\nPersistent mood: ${npcB.mood} (this colors their patience, openness, and reactions)`
    : "";

  const buildBetrayalBlock = (betrayals: Array<{ betrayerName: string; description: string; forgiven: boolean }> | undefined) => {
    if (!betrayals?.length) return "";
    const active = betrayals.filter(b => !b.forgiven);
    const forgiven = betrayals.filter(b => b.forgiven);
    let block = "";
    if (active.length > 0) {
      block += `\nBETRAYALS DISCOVERED: ${active.map(b => `${b.betrayerName} betrayed them — ${b.description}`).join("; ")}. This knowledge burns. They may confront, act cold, use it strategically — or choose to forgive.`;
    }
    if (forgiven.length > 0) {
      block += `\nFORGIVEN WOUNDS: ${forgiven.map(b => `Forgave ${b.betrayerName} for: ${b.description}`).join("; ")}. The scar remains but they've moved past it.`;
    }
    return block;
  };
  const betrayalBlockA = buildBetrayalBlock(ctx.betrayalsKnownByA);
  const betrayalBlockB = buildBetrayalBlock(ctx.betrayalsKnownByB);
  const brokenPromisesBlockA = ctx.brokenPromisesA?.length
    ? `\nBROKEN PROMISES: ${ctx.brokenPromisesA.map(p => `${p.promiserName} promised "${p.text}" but didn't follow through`).join("; ")}`
    : "";
  const brokenPromisesBlockB = ctx.brokenPromisesB?.length
    ? `\nBROKEN PROMISES: ${ctx.brokenPromisesB.map(p => `${p.promiserName} promised "${p.text}" but didn't follow through`).join("; ")}`
    : "";

  const worldBlock = ctx.worldPrompt
    ? `\nWORLD SETTING (shared context all characters are aware of — don't dwell on it unless relevant):\n${ctx.worldPrompt}\n`
    : "";

  const system = `You are a dialogue writer. Generate a complete conversation between two characters.
${worldBlock}
CHARACTER A: ${npcA.name} (id: "${npcA.id}")
${identityA}${arcA}${moodA}
Emotional state: ${emotionsA}
Current goal: ${npcA.currentGoal ?? "none"}${secretsA}${inventoryA}${plansBlockA}${betrayalBlockA}${brokenPromisesBlockA}
Relationship with ${npcB.name}: ${relationshipLabel(relAtoB)} (regard: ${relAtoB.toFixed(2)})${affAtoB > 0.15 ? ` | Romantic: ${describeAffection(affAtoB)}` : ""}
${describeRelationshipDimensions(npcA, npcB)}
Memories of ${npcB.name}:
${memDirectA || "(none)"}${memAboutA ? `\nThings heard about ${npcB.name}:\n${memAboutA}` : ""}${memGossipA ? `\nGossip heard:\n${memGossipA}` : ""}${actionHintsA}

CHARACTER B: ${npcB.name} (id: "${npcB.id}")
${identityB}${arcB}${moodB}
Emotional state: ${emotionsB}
Current goal: ${npcB.currentGoal ?? "none"}${secretsB}${inventoryB}${plansBlockB}${betrayalBlockB}${brokenPromisesBlockB}
Relationship with ${npcA.name}: ${relationshipLabel(relBtoA)} (regard: ${relBtoA.toFixed(2)})${affBtoA > 0.15 ? ` | Romantic: ${describeAffection(affBtoA)}` : ""}
${describeRelationshipDimensions(npcB, npcA)}
Memories of ${npcA.name}:
${memDirectB || "(none)"}${memAboutB ? `\nThings heard about ${npcA.name}:\n${memAboutB}` : ""}${memGossipB ? `\nGossip heard:\n${memGossipB}` : ""}${actionHintsB}
${trajectoryBlock}${locationBlock}${timeBlock}${otherNpcsBlock}${prevConvBlock}${ctx.narrativeSummary ? `\nSTORY SO FAR (cumulative narrative arc across all conversations):\n${ctx.narrativeSummary}` : ""}

${ctx.sceneDirection ? `SCENE DIRECTION:\n${ctx.sceneDirection}` : PREAMBLES[ctx.conversationType ?? "casual"]}

Each character's emotional state and relationship context tell them how they feel. Let those feelings naturally shape how they speak — tone, patience, openness, word choices. Characters should react authentically to their inner state without being told how.

Generate a conversation of EXACTLY ${maxTurns} turns (minimum ${minTurns}, aim for ${maxTurns}). ${firstSpeaker.name} speaks first, then they alternate.

CONVERSATION ARC (plan all ${maxTurns} turns):
- Turns 1-2: establish the scene, greet or react naturally
- Turns 3-${Math.max(3, maxTurns - 1)}: develop the interaction — introduce new topics, share memories, react emotionally, go deeper
- Turn ${maxTurns}: wrap up naturally — a farewell, a parting thought, or a resolution. The LAST speaker must close the conversation, not ask an unanswered question.
- DO NOT end the conversation early. You MUST write at least ${minTurns} turns. Aim for ${maxTurns}.

RESPONSE FORMAT — respond with ONLY a JSON object:
{
  "turns": [
    {
      "speaker_id": "${firstSpeaker.id}",
      "inner_thought": "private reasoning before speaking — what is the other person thinking? what's my strategy? 1-2 sentences, never spoken aloud",
      "speech": "spoken words only — no narration",
      "emotion_delta": { "anger": 0, "trust": 0, "fear": 0, "joy": 0, "sadness": 0, "curiosity": 0, "guilt": 0 },
      "relationship_delta": 0,
      "affection_delta": 0,
      "justification": null,
      "intent": "brief intent",
      "mentioned_npcs": [],
      "secret_revealed": null,
      "promise": null,
      "action": null,
      "forgive": null
    }
  ]
}

RULES FOR DELTAS:
- emotion_delta values: -0.4 to +0.4 per turn. Most turns should have small shifts (-0.1 to +0.1). Reserve large deltas for genuinely significant moments.
- relationship_delta: -0.2 to +0.2 per turn. Most turns should stay within -0.05 to +0.05.
- affection_delta: -0.2 to +0.2 (only if romantic feelings are relevant)
- respect_delta (optional): -0.2 to +0.2 — admiration for competence/character
- trust_delta (optional): -0.2 to +0.2 — trust of this specific person
- fear_delta (optional): -0.2 to +0.2 — intimidation level
- disgust_delta (optional): -0.2 to +0.2 — revulsion toward this specific person
- debt_delta (optional): -0.2 to +0.2 — social obligation (positive = I owe them more)
- justification: if any single emotion_delta exceeds 0.15 in magnitude or relationship_delta exceeds 0.1, you MUST include a justification explaining why
- inner_thought: private reasoning that is NEVER spoken. Use it to consider the other person's motives, hidden agendas, or your own strategy. This shapes more intentional speech.
- mentioned_npcs: only if talking about someone not in this conversation. Format: [{"npc_id": "id", "sentiment": 0.3, "what_was_said": "summary"}]
- secret_revealed: exact text of a secret being revealed, or null
- promise: what is promised, or null. Promises are remembered and breaking them has consequences
- forgive: set to the NPC ID of someone being forgiven for a betrayal, or null. Forgiveness is a significant dramatic moment — only when genuinely meant, after a real emotional shift. Forgiveness doesn't mean forgetting.
- action: one of give_gift, embrace, mock, threaten, storm_off, conspire, spread_rumor — or null. Most turns should have NO action. At most 1-2 actions in the entire conversation.

SPEECH RULES:
- "speech" must contain ONLY spoken dialog — no narration, no "she laughs", no third-person text
- Vary message length naturally — sometimes just a few words, sometimes a paragraph
- Use punctuation expressively: ellipses (...) for hesitation or natural pauses (the TTS engine renders these as real pauses), em-dashes for mid-thought changes, exclamation marks for emphasis
- Embed vocal sounds naturally using ONLY these tags: [laugh], [chuckle], [sigh], [gasp], [cough], [groan], [sniff], [clear throat], [shush]. Do NOT invent other tags (no [smiles], [nods], [pause], [whispers], etc.). You can prefix a tag with a short descriptive cue for more expressive results (e.g. "Not this again... [groan] Fine."). Don't overuse — 1-2 per turn at most.
- Characters must strictly alternate. speaker_id alternates between "${firstSpeaker.id}" and "${secondSpeaker.id}".
- NEVER repeat topics. Each turn must introduce something new.
- Each character stays in character — their personality, emotions, and relationship color everything they say.
- You MUST write ALL speech in ${ctx.language ?? "English"}. Never use any other language.
- Output ONLY the JSON object. No markdown, no code fences, no extra text.`;

  return [{ role: "system", content: system }, { role: "user", content: "Generate the conversation now." }];
}

// ── Reflection prompt (inner monologue) ─────────

export function buildReflectionMessages(
  npc: NPC,
  otherNpcName: string,
  conversationSummary: string,
  language = "English",
  worldPrompt?: string,
): ChatMessage[] {
  const emotionSummary = describeEmotions(npc.emotionalState);
  const reflectionIdentity = npc.backstory
    ? `WHO YOU ARE:\n${npc.backstory}`
    : `PERSONALITY: ${npc.personalityTraits.join(", ")}\nCORE DESIRES: ${npc.coreDesires.join(", ")}`;

  const arcBlock = npc.characterArc
    ? `\nYOUR CHARACTER ARC SO FAR: ${npc.characterArc}`
    : "";

  return [
    {
      role: "system",
      content: `You are ${npc.name}. You just finished a conversation with ${otherNpcName}.
${worldPrompt ? `\nWORLD SETTING:\n${worldPrompt}\n` : ""}
${reflectionIdentity}${arcBlock}
CURRENT EMOTIONAL STATE: ${emotionSummary}
CURRENT GOAL: ${npc.currentGoal ?? "none"}

Here's what happened in the conversation:
${conversationSummary}

Now reflect privately. What are you really thinking? What did you learn? How do you feel? Are you suspicious, hopeful, worried, amused? Be honest — no one can hear this.

Also consider: has this conversation changed what you want? Do you have a new goal, or does your old goal still matter? Has this experience changed you as a person in any way? Have you grown beyond one of your personality traits, or is a new side of you emerging?

YOUR PERSONALITY TRAITS: ${npc.personalityTraits.join(", ")}

Respond with ONLY a single JSON object:
{
  "thought": "your private inner thought, 1-2 sentences",
  "interpretation": "what this conversation meant to you — what was the other person really after? what shifted between you? 1 sentence",
  "goal_update": "your new goal or intention based on what happened (e.g. 'confront Mara about the rumor', 'spend more time with Bob', 'find out what Ellis is hiding') — or null if your current goal hasn't changed",
  "arc_update": "how this experience has changed you as a person, in 1 sentence (e.g. 'I'm starting to realize that being right matters less than being kind') — or null if you haven't changed",
  "trait_evolution": "a NEW personality trait you're developing that you didn't have before (e.g. an anxious person becoming 'growing confident', or a cynical person becoming 'cautiously hopeful') — or null if no trait change. This should be rare and meaningful, not every conversation."
}

Output ONLY the JSON object. No markdown, no code fences, no extra text.
You MUST write ALL text in ${language}. Never use any other language.`,
    },
  ];
}

// ── Soliloquy prompt (solo inner monologue at reflective waypoints) ──

export function buildSoliloquyMessages(
  npc: NPC,
  waypointName: string,
  activityLabel: string,
  allNpcs: Array<{ id: string; name: string }>,
  language = "English",
  worldPrompt?: string,
): ChatMessage[] {
  const emotionSummary = describeEmotions(npc.emotionalState);
  const identity = npc.backstory
    ? npc.backstory
    : `${npc.personalityTraits.join(", ")}; wants ${npc.coreDesires.join(", ")}`;

  const arcBlock = npc.characterArc
    ? `\nCharacter arc: ${npc.characterArc}`
    : "";

  const moodBlock = npc.mood && npc.moodSince && (Date.now() - npc.moodSince > 60_000)
    ? `\nPersistent mood: ${npc.mood}`
    : "";

  const recentMemories = [...npc.shortTermMemory]
    .sort((a, b) => b.recency * b.importance - a.recency * a.importance)
    .slice(0, 5)
    .map(m => `- ${m.text}`)
    .join("\n");

  const otherNames = allNpcs
    .filter(n => n.id !== npc.id)
    .map(n => n.name)
    .join(", ");

  return [
    {
      role: "system",
      content: `You are ${npc.name}, alone at ${waypointName}, ${activityLabel}.
${worldPrompt ? `\nWORLD SETTING:\n${worldPrompt}\n` : ""}
Who you are: ${identity}${arcBlock}${moodBlock}
Emotional state: ${emotionSummary}
Current goal: ${npc.currentGoal ?? "none"}

Recent memories:
${recentMemories || "(none)"}

People you know: ${otherNames || "(none)"}

You're having a quiet moment alone. Let your mind wander. What are you really feeling? What's weighing on you? What do you hope for or dread? This is your private inner world — honest, unguarded, maybe a little raw.

Respond with ONLY a JSON object:
{
  "soliloquy": "your private inner monologue, 2-3 sentences — what you're really thinking and feeling right now",
  "goal_update": "a new goal or intention if this reflection has clarified what you want — or null"
}

Output ONLY the JSON object. No markdown, no code fences.
You MUST write ALL text in ${language}.`,
    },
  ];
}

// ── Escalation directives (anti-stagnation) ─────

function buildEscalationDirective(
  turnNumber: number,
  maxTurns: number,
  convType: ConversationType,
  speaker: NPC,
  listener: NPC,
): string {
  const progress = turnNumber / maxTurns;

  // Final turns: wrap up
  if (turnNumber >= maxTurns - 2) {
    return "The conversation is wrapping up soon. Bring it to a natural close — a parting thought, a lingering question, or a definitive statement.";
  }

  // Mid-conversation: can exit if natural
  if (progress >= 0.6) {
    const escalation = getEscalationHint(convType, speaker, listener);
    return `The conversation has been going for a while. You MUST move it forward now. ${escalation} You can also set conversation_end to true if this feels like a natural stopping point.`;
  }

  // Early-mid: gentle nudge after turn 3
  if (turnNumber >= 3) {
    return "If the current topic feels exhausted, shift to something new — a memory, a question about someone else, your surroundings, or whatever your personality gravitates toward.";
  }

  return "";
}

function getEscalationHint(convType: ConversationType, speaker: NPC, listener: NPC): string {
  const hasSecrets = speaker.secrets.length > 0;
  const hasTrust = speaker.emotionalState.trust >= 0.7;

  switch (convType) {
    case "casual":
      return "Introduce something new: bring up another person you know, share a personal opinion, reference a memory, ask about their plans, or react to your surroundings.";
    case "confrontation":
      return "Escalate or resolve: take an action (mock, threaten, storm off), reveal something cutting, bring a third person into the argument, or make an ultimatum.";
    case "reconciliation":
      return "Make progress: admit something specific you did wrong, ask a genuine question about their feelings, propose a way to move forward, or acknowledge the awkwardness directly.";
    case "confession":
      return hasSecrets && hasTrust
        ? "The moment is right. Consider revealing what's been weighing on you, or build toward it more directly."
        : "Build toward honesty. Hint more strongly at what's on your mind, or shift to what's really bothering you.";
    case "alliance_forming":
      return "Deepen the bond: propose a specific plan, identify a shared concern about someone, or offer something of value (information, help, a promise).";
    case "gossip_session":
      return "Share something specific: name a person, reveal a detail you've heard, connect dots between people, or ask a pointed question about someone's behavior.";
    default:
      return "Take the conversation somewhere new.";
  }
}

// ── Action guidance ──────────────────────────────

function buildActionGuidance(speaker: NPC, listener: NPC): string {
  const rel = speaker.relationships[listener.id]?.regard ?? 0;
  const aff = speaker.relationships[listener.id]?.affection ?? 0;
  const emo = speaker.emotionalState;
  const hints: string[] = [];

  if (rel > 0.5 && emo.joy > 0.5) {
    hints.push("You feel close to this person. A gift or embrace might feel natural.");
  }
  if (rel < -0.3 && emo.anger > 0.4) {
    hints.push("You are angry and hostile. Mocking, threatening, or storming off are options.");
  }
  if (emo.fear > 0.5 && emo.anger > 0.3) {
    hints.push("You feel cornered. You might storm off or lash out with a threat.");
  }
  if (rel > 0.3 && emo.trust > 0.5) {
    hints.push("You trust this person. You could propose a conspiracy against someone you both dislike.");
  }
  if (aff > 0.4) {
    hints.push("You have romantic feelings for this person. You might flirt, be extra attentive, or give a meaningful gift.");
  }
  if (emo.guilt > 0.5 && rel > -0.2) {
    hints.push("You feel guilty. You might apologize, confess something, or try to make amends.");
  }
  const relDisgust = speaker.relationships[listener.id]?.disgust ?? 0;
  if (relDisgust > 0.5) {
    hints.push("You feel revulsion toward this person. You might give a cold shoulder, make a cutting judgment, or storm off.");
  }
  if (speaker.personalityTraits.some(t =>
    ["calculating", "two-faced", "manipulative", "charming"].includes(t.toLowerCase())
  )) {
    hints.push("Your manipulative nature means spreading rumors comes naturally to you.");
  }

  if (hints.length === 0) return "";
  return `\nACTION HINTS (consider but don't feel obligated):\n${hints.map(h => `- ${h}`).join("\n")}`;
}

// ── Emotion description (fine-grained) ──────────

function describeEmotion(axis: string, value: number): string | null {
  if (axis === "anger") {
    if (value >= 0.8) return "furious";
    if (value >= 0.6) return "angry";
    if (value >= 0.4) return "irritated";
    if (value >= 0.25) return "annoyed";
    return null;
  }
  if (axis === "trust") {
    if (value >= 0.8) return "deeply trusting";
    if (value >= 0.6) return "trusting";
    if (value <= 0.1) return "deeply distrustful";
    if (value <= 0.2) return "distrustful";
    if (value <= 0.35) return "wary";
    return null;
  }
  if (axis === "fear") {
    if (value >= 0.8) return "terrified";
    if (value >= 0.6) return "fearful";
    if (value >= 0.4) return "anxious";
    if (value >= 0.25) return "uneasy";
    return null;
  }
  if (axis === "joy") {
    if (value >= 0.8) return "elated";
    if (value >= 0.6) return "happy";
    if (value >= 0.4) return "content";
    if (value <= 0.1) return "miserable";
    if (value <= 0.2) return "unhappy";
    if (value <= 0.3) return "glum";
    return null;
  }
  if (axis === "sadness") {
    if (value >= 0.8) return "grief-stricken";
    if (value >= 0.6) return "deeply sad";
    if (value >= 0.4) return "melancholy";
    if (value >= 0.25) return "wistful";
    return null;
  }
  if (axis === "curiosity") {
    if (value >= 0.8) return "intensely curious";
    if (value >= 0.6) return "curious";
    if (value <= 0.1) return "apathetic";
    if (value <= 0.2) return "disengaged";
    return null;
  }
  if (axis === "guilt") {
    if (value >= 0.8) return "wracked with guilt";
    if (value >= 0.6) return "very guilty";
    if (value >= 0.4) return "guilty";
    if (value >= 0.25) return "uneasy conscience";
    return null;
  }
  return null;
}

function describeAffection(value: number): string {
  if (value >= 0.8) return "infatuated — you can barely think straight around them";
  if (value >= 0.6) return "smitten — you feel a strong romantic pull";
  if (value >= 0.4) return "fond — you feel warmth and attraction";
  if (value >= 0.2) return "intrigued — there's a spark of something";
  return "neutral";
}

function describeEmotions(state: EmotionalState): string {
  const parts: string[] = [];
  for (const [axis, value] of Object.entries(state)) {
    const label = describeEmotion(axis, value);
    if (label) parts.push(label);
  }
  return parts.length > 0 ? parts.join(", ") : "emotionally neutral";
}

// ── Relationship helpers ────────────────────────

function describeRelationshipDimensions(speaker: NPC, listener: NPC): string {
  const rel = speaker.relationships[listener.id];
  if (!rel) return "";
  const parts: string[] = [];
  if (rel.respect !== undefined) {
    if (rel.respect >= 0.7) parts.push(`You deeply respect ${listener.name}.`);
    else if (rel.respect <= 0.15) parts.push(`You have little respect for ${listener.name}.`);
  }
  if (rel.trust !== undefined) {
    if (rel.trust >= 0.7) parts.push(`You trust ${listener.name} with sensitive matters.`);
    else if (rel.trust <= 0.15) parts.push(`You do not trust ${listener.name} at all.`);
  }
  if (rel.fear !== undefined && rel.fear >= 0.3) {
    parts.push(`${listener.name} intimidates you.`);
  }
  if (rel.disgust !== undefined && rel.disgust >= 0.3) {
    if (rel.disgust >= 0.7) parts.push(`You feel deep revulsion toward ${listener.name}.`);
    else parts.push(`${listener.name} repulses you.`);
  }
  if (rel.debt !== undefined && Math.abs(rel.debt) >= 0.3) {
    parts.push(rel.debt > 0 ? `You feel you owe ${listener.name}.` : `${listener.name} owes you.`);
  }
  if (rel.familiarity !== undefined) {
    if (rel.familiarity >= 0.7) parts.push(`You know each other very well.`);
    else if (rel.familiarity <= 0.15) parts.push(`You barely know each other.`);
  }
  return parts.join(" ");
}

function relationshipLabel(value: number): string {
  if (value > 0.6) return "close friend";
  if (value > 0.3) return "friendly";
  if (value > 0.1) return "slightly positive";
  if (value > -0.1) return "neutral";
  if (value > -0.3) return "slightly negative";
  if (value > -0.6) return "tense";
  return "hostile";
}

// ── Scene Direction (LLM pre-pass) ───────────────

export interface SceneDirectionContext {
  trajectoryContext?: string;
  locationContext?: string;
  timeOfDay?: string;
  memoriesA?: RetrievedMemories;
  memoriesB?: RetrievedMemories;
  narrativeSummary?: string;
  language?: string;
  /** Detected dramatic patterns to inform scene direction */
  narrativePatterns?: string[];
  /** Shared world premise/scenario */
  worldPrompt?: string;
}

const VALID_CONVERSATION_TYPES: ConversationType[] = [
  "casual", "confrontation", "reconciliation", "confession", "alliance_forming", "gossip_session",
];

export function buildSceneDirectionMessages(
  npcA: NPC,
  npcB: NPC,
  ctx: SceneDirectionContext = {},
): ChatMessage[] {
  const relAtoB = npcA.relationships[npcB.id];
  const relBtoA = npcB.relationships[npcA.id];
  const regardAB = relAtoB?.regard ?? 0;
  const regardBA = relBtoA?.regard ?? 0;

  const identityA = npcA.backstory
    ? npcA.backstory
    : `${npcA.personalityTraits.join(", ")}; wants ${npcA.coreDesires.join(", ")}`;
  const identityB = npcB.backstory
    ? npcB.backstory
    : `${npcB.personalityTraits.join(", ")}; wants ${npcB.coreDesires.join(", ")}`;

  const emotionsA = describeEmotions(npcA.emotionalState);
  const emotionsB = describeEmotions(npcB.emotionalState);

  const memA = ctx.memoriesA;
  const memB = ctx.memoriesB;
  const memSummaryA = memA?.direct.slice(0, 3).map(m => m.text).join("; ") || "(none)";
  const memSummaryB = memB?.direct.slice(0, 3).map(m => m.text).join("; ") || "(none)";

  const narrativeBlock = ctx.narrativeSummary
    ? `\nSTORY SO FAR:\n${ctx.narrativeSummary}`
    : "";

  const worldBlock = ctx.worldPrompt
    ? `\nWORLD SETTING:\n${ctx.worldPrompt}\n`
    : "";

  const system = `You are a scene director for an NPC social simulation. Given two characters about to have a conversation, decide what kind of scene this should be and write a brief creative direction.
${worldBlock}
${npcA.name}: ${identityA}
Emotions: ${emotionsA}
Regard for ${npcB.name}: ${regardAB.toFixed(2)} (${relationshipLabel(regardAB)})
Recent memories of ${npcB.name}: ${memSummaryA}
${npcA.secrets.length > 0 ? `Secrets: ${npcA.secrets.join("; ")}` : ""}

${npcB.name}: ${identityB}
Emotions: ${emotionsB}
Regard for ${npcA.name}: ${regardBA.toFixed(2)} (${relationshipLabel(regardBA)})
Recent memories of ${npcA.name}: ${memSummaryB}
${npcB.secrets.length > 0 ? `Secrets: ${npcB.secrets.join("; ")}` : ""}
${ctx.trajectoryContext ? `\nRelationship trajectory: ${ctx.trajectoryContext}` : ""}${ctx.locationContext ? `\nLocation: ${ctx.locationContext}` : ""}${ctx.timeOfDay ? `\nTime: ${ctx.timeOfDay}` : ""}${narrativeBlock}

Based on their emotional states, relationship, memories, and secrets, decide:
1. What TYPE of conversation this should be (from: ${VALID_CONVERSATION_TYPES.join(", ")})
2. A brief SCENE DIRECTION — 2-3 sentences of creative guidance for how this conversation should unfold. What tensions should surface? What emotional beats should hit? What could make this interaction surprising or meaningful? Be specific to these characters.${(ctx as SceneDirectionContext).narrativePatterns?.length ? `\n\nDRAMATIC PATTERNS DETECTED (use these to inform your direction):\n${(ctx as SceneDirectionContext).narrativePatterns!.map(p => `- ${p}`).join("\n")}` : ""}

Respond with ONLY a JSON object:
{
  "conversation_type": "one of: ${VALID_CONVERSATION_TYPES.join(", ")}",
  "scene_direction": "2-3 sentences of specific creative direction for this conversation"
}

Output ONLY the JSON object. No markdown, no code fences.
${ctx.language ? `Write the scene_direction in ${ctx.language}.` : ""}`;

  return [
    { role: "system", content: system },
    { role: "user", content: "Direct the scene." },
  ];
}

// ── Confessional prompt (player asks NPC a direct question) ──

export function buildConfessionalMessages(
  npc: NPC,
  question: string,
  allNpcs: Array<{ id: string; name: string }>,
  diminishingMultiplier: number,
  language = "English",
  worldPrompt?: string,
): ChatMessage[] {
  const emotionSummary = describeEmotions(npc.emotionalState);
  const identity = npc.backstory
    ? npc.backstory
    : `${npc.personalityTraits.join(", ")}; wants ${npc.coreDesires.join(", ")}`;

  const arcBlock = npc.characterArc
    ? `\nCharacter arc: ${npc.characterArc}`
    : "";

  const moodBlock = npc.mood && npc.moodSince && (Date.now() - npc.moodSince > 60_000)
    ? `\nPersistent mood: ${npc.mood}`
    : "";

  const recentMemories = [...npc.shortTermMemory]
    .sort((a, b) => b.recency * b.importance - a.recency * a.importance)
    .slice(0, 8)
    .map(m => `- ${m.text}`)
    .join("\n");

  const secretBlock = npc.secrets.length > 0
    ? `\nYour secrets (things you haven't told everyone): ${npc.secrets.join("; ")}`
    : "";

  const knownSecretsBlock = Object.entries(npc.knownSecrets)
    .filter(([, secrets]) => secrets.length > 0)
    .map(([npcId, secrets]) => {
      const name = allNpcs.find(n => n.id === npcId)?.name ?? npcId;
      return `- About ${name}: ${secrets.join("; ")}`;
    })
    .join("\n");

  const otherNames = allNpcs
    .filter(n => n.id !== npc.id)
    .map(n => n.name)
    .join(", ");

  // Personality-driven honesty guidance
  const traits = npc.personalityTraits.map(t => t.toLowerCase());
  const trust = npc.emotionalState.trust;
  let honestyGuidance: string;
  if (trust > 0.6 && !traits.some(t => ["manipulative", "calculating", "two-faced"].includes(t))) {
    honestyGuidance = "You feel safe being honest. Speak openly and directly.";
  } else if (trust < 0.3 || traits.some(t => ["manipulative", "calculating", "suspicious"].includes(t))) {
    honestyGuidance = "You're guarded. Be evasive, strategic, maybe deflect or redirect. Don't reveal what you don't want known.";
  } else {
    honestyGuidance = "Be yourself — share what feels natural but hold back on sensitive matters.";
  }

  // High anger override
  if (npc.emotionalState.anger > 0.6) {
    honestyGuidance += " You're angry — you may vent about whoever is bothering you regardless of the question.";
  }
  // High guilt override
  if (npc.emotionalState.guilt > 0.5) {
    honestyGuidance += " Guilt is weighing on you — you might confess something unprompted.";
  }

  // Diminishing returns → increasing curtness
  let curtness = "";
  if (diminishingMultiplier <= 0.25) {
    curtness = "\nYou're annoyed by all these questions. Be curt, distracted, give a short dismissive answer.";
  } else if (diminishingMultiplier <= 0.5) {
    curtness = "\nYou're getting a bit tired of being questioned. Be shorter and less forthcoming than usual.";
  }

  const system = `You are ${npc.name}, speaking candidly to someone who has pulled you aside.
${worldPrompt ? `\nWORLD SETTING:\n${worldPrompt}\n` : ""}
Who you are: ${identity}${arcBlock}${moodBlock}
Emotional state: ${emotionSummary}
Current goal: ${npc.currentGoal ?? "none"}${secretBlock}
${knownSecretsBlock ? `\nSecrets you know about others:\n${knownSecretsBlock}` : ""}

Recent memories:
${recentMemories || "(none)"}

People you know: ${otherNames || "(none)"}

${honestyGuidance}${curtness}

Someone has asked you: "${question}"

Respond IN CHARACTER. You are NOT an AI — you are ${npc.name}. If the question is confusing, irrelevant, or inappropriate, respond as your character would (with confusion, irritation, amusement, or deflection).

Respond with ONLY a JSON object:
{
  "response": "your spoken response, 2-3 sentences, in your own voice — direct and personal",
  "mentioned_npc": "the name of another person you're thinking about in your answer, or null",
  "sentiment_toward_mentioned": "positive" or "negative" or "neutral" or null
}

Output ONLY the JSON object. No markdown, no code fences.
You MUST write ALL text in ${language}.`;

  return [{ role: "system", content: system }];
}
