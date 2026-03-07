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
- Emotional reactions should be raw and unfiltered. Let anger, disgust, or distrust drive your words.`,

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
  "speech": "your actual spoken words ONLY — no narration, no action descriptions, no third-person text like 'she smiles' or 'he hands over'. Just the words that come out of your mouth.",
  "emotion_delta": { "anger": 0, "trust": 0, "fear": 0, "joy": 0, "sadness": 0, "curiosity": 0, "disgust": 0, "guilt": 0 },
  "relationship_delta": 0,
  "affection_delta": 0,
  "intent": "brief description of your goal in saying this",
  "conversation_end": false,
  "mentioned_npcs": [],
  "secret_revealed": null,
  "promise": null,
  "action": null
}

RULES FOR DELTAS:
- emotion_delta values range from -0.2 to +0.2 (small shifts per turn). Emotions: anger, trust, fear, joy, sadness, curiosity, disgust, guilt
- relationship_delta ranges from -0.1 to +0.1 (general regard — how much you like/dislike them)
- affection_delta ranges from -0.1 to +0.1 (romantic/deep attraction — set this if you feel a romantic pull, warmth, or infatuation toward this person. Leave at 0 if feelings are purely platonic)
- Set conversation_end to true only if you want to end the conversation
- mentioned_npcs is optional. Only include if you talk about someone not in this conversation. Format: [{"npc_id": "id", "sentiment": 0.3, "what_was_said": "brief summary"}]
- secret_revealed: set to the exact text of a secret you're revealing, or null
- promise: set to what you promise, or null. Promises are remembered and breaking them has consequences

ACTIONS (optional — set "action" to one of these, or null):
- {"action": "give_gift", "detail": "description of the gift"} — Give a symbolic gift to show goodwill. Only if you genuinely want to strengthen the bond.
- {"action": "embrace", "detail": "description"} — Show warmth or affection physically. Only when trust is high and the moment feels right.
- {"action": "mock", "detail": "what you mock them about"} — Publicly belittle or ridicule. Use when angry, contemptuous, or competitive.
- {"action": "threaten", "detail": "the threat"} — Intimidate the other person. Use when you want to establish dominance or punish.
- {"action": "storm_off"} — Abruptly leave the conversation. Ends the conversation immediately. Use when you've had enough.
- {"action": "conspire", "target_npc_id": "id", "detail": "the plan"} — Whisper a scheme against a third person. Only with someone you trust enough.
- {"action": "spread_rumor", "target_npc_id": "id", "detail": "the rumor"} — Plant a false or exaggerated claim about a third person.
- IMPORTANT: Most turns should have NO action (null). Actions are dramatic moments — use them sparingly, maybe once per conversation at most.

- CRITICAL: "speech" must contain ONLY your spoken dialog — the literal words you say. NEVER put narration, action descriptions, or third-person text in speech (wrong: "Ivy smiles and offers a cake" — right: "Here, I brought you some cake!"). Use the "action" field for physical actions.
- Output ONLY the JSON object. No markdown, no code fences, no extra text.`;

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

  const emotionGuidance = emotionBehavioralGuidance(speaker.emotionalState);
  const relGuidance = relationshipBehavioralGuidance(
    relationship,
    listener.name
  );
  const allGuidance = [...emotionGuidance, ...relGuidance];

  const mem = ctx.retrievedMemories;
  const relevantMemories = mem
    ? mem.direct.map((m) => `- ${m.text}`).join("\n")
    : "";
  const gossipMemories = mem
    ? mem.gossip.map((m) => `- ${m.text}`).join("\n")
    : "";
  const aboutListenerMemories = mem
    ? mem.aboutPartner.map((m) => `- ${m.text}`).join("\n")
    : "";

  const behavioralBlock =
    allGuidance.length > 0
      ? `\nBEHAVIORAL GUIDANCE (follow these closely):\n${allGuidance.map((g) => `- ${g}`).join("\n")}`
      : "";

  // Other NPCs the speaker knows about
  const otherNpcs = (ctx.allNpcs ?? []).filter(
    (n) => n.id !== speaker.id && n.id !== listener.id
  );
  const otherNpcsBlock =
    otherNpcs.length > 0
      ? `\nOTHER PEOPLE YOU KNOW:\n${otherNpcs.map((n) => `- ${n.name} (id: "${n.id}")`).join("\n")}`
      : "";

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

  return `You are ${speaker.name}.

PERSONALITY: ${speaker.personalityTraits.join(", ")}
CORE DESIRES: ${speaker.coreDesires.join(", ")}
CURRENT EMOTIONAL STATE: ${emotionSummary}
CURRENT GOAL: ${speaker.currentGoal ?? "none"}
${secretsBlock}${inventoryBlock}

You are talking to ${listener.name}.
YOUR RELATIONSHIP WITH ${listener.name}: ${relLabel} (regard: ${relationship.toFixed(2)})${affection > 0.15 ? `\nROMANTIC FEELINGS: ${describeAffection(affection)}` : ""}
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
${behavioralBlock}
${actionHints}

CONVERSATION PROGRESS: Turn ${turnNumber + 1} of ${maxTurns}.
${buildEscalationDirective(turnNumber, maxTurns, ctx.conversationType ?? "casual", speaker, listener)}

RESPONSE FORMAT:
- Stay in character. Vary your message length naturally — sometimes just a word or two ("Yeah." / "No way."), sometimes a full paragraph. Match the energy: quick banter should be short, emotional or story-heavy moments can be longer. Don't always write the same amount.
- Use punctuation expressively to convey emotion: ellipses for hesitation or trailing off ("I don't know..."), exclamation marks for strong feeling, em-dashes for interrupting yourself or changing tack mid-sentence ("I was going to — actually, never mind"), commas and periods for natural breathing rhythm. Your speech will be read aloud, so punctuation shapes how it sounds.
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
        emotion_delta: { anger: 0, trust: 0, fear: 0, joy: 0, sadness: 0, curiosity: 0, disgust: 0, guilt: 0 },
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

    const relationshipFraming =
      rel <= -0.3 ? `You notice ${listener.name} nearby. You're not thrilled about it.${locationSeed}`
      : rel >= 0.5 ? `You spot ${listener.name} — someone you're glad to see.${locationSeed}`
      : `You notice ${listener.name} nearby.${locationSeed}`;

    msgs.push({
      role: "user",
      content: `${relationshipFraming}${groundingHint} Be specific — no generic greetings. Respond with ONLY a JSON object.`,
    });
  }

  return msgs;
}

// ── Reflection prompt (inner monologue) ─────────

export function buildReflectionMessages(
  npc: NPC,
  otherNpcName: string,
  conversationSummary: string,
  language = "English",
): ChatMessage[] {
  const emotionSummary = describeEmotions(npc.emotionalState);
  return [
    {
      role: "system",
      content: `You are ${npc.name}. You just finished a conversation with ${otherNpcName}.

PERSONALITY: ${npc.personalityTraits.join(", ")}
CORE DESIRES: ${npc.coreDesires.join(", ")}
CURRENT EMOTIONAL STATE: ${emotionSummary}

Here's what happened in the conversation:
${conversationSummary}

Now reflect privately. What are you really thinking? What did you learn? How do you feel? Are you suspicious, hopeful, worried, amused? Be honest — no one can hear this.

Respond with ONLY a single JSON object:
{
  "thought": "your private inner thought, 1-2 sentences"
}

Output ONLY the JSON object. No markdown, no code fences, no extra text.
You MUST write ALL text in ${language}. Never use any other language.`,
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
  if (emo.disgust > 0.5) {
    hints.push("You feel revulsion. You might give a cold shoulder, make a cutting judgment, or storm off.");
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
  if (axis === "disgust") {
    if (value >= 0.8) return "revolted";
    if (value >= 0.6) return "disgusted";
    if (value >= 0.4) return "repulsed";
    if (value >= 0.25) return "put off";
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

// ── Emotion → behavioral guidance ───────────────

const emotionGuidanceCache = new Map<string, string[]>();
const relationshipGuidanceCache = new Map<string, string[]>();

function bucketEmotion(v: number): string {
  if (v >= 0.8) return "8";
  if (v >= 0.7) return "7";
  if (v >= 0.4) return "4";
  if (v >= 0.3) return "3";
  if (v >= 0.25) return "25";
  if (v >= 0.15) return "15";
  return "0";
}

function emotionBehavioralGuidance(state: EmotionalState): string[] {
  const key = `${bucketEmotion(state.anger)}_${bucketEmotion(state.trust)}_${bucketEmotion(state.fear)}_${bucketEmotion(state.joy)}_${bucketEmotion(state.sadness)}_${bucketEmotion(state.curiosity)}_${bucketEmotion(state.disgust)}_${bucketEmotion(state.guilt)}`;
  const cached = emotionGuidanceCache.get(key);
  if (cached) return cached;

  const guidance: string[] = [];

  // Anger
  if (state.anger >= 0.7) {
    guidance.push(
      "You are seething. Be confrontational, cutting, and sharp. Do not hold back criticism. " +
        "You may raise your voice, use biting sarcasm, or directly attack what the other person says."
    );
  } else if (state.anger >= 0.4) {
    guidance.push(
      "You are irritated. Be curt, impatient, and ready to push back. " +
        "Challenge statements you disagree with. Don't smooth things over."
    );
  } else if (state.anger >= 0.25) {
    guidance.push(
      "You are mildly annoyed. Let it show through clipped responses or subtle barbs."
    );
  }

  // Trust
  if (state.trust <= 0.15) {
    guidance.push(
      "You deeply distrust this person. Be guarded, evasive, and suspicious. " +
        "Read hidden motives into what they say. Don't share personal information. " +
        "Question their intentions openly or through pointed remarks."
    );
  } else if (state.trust <= 0.3) {
    guidance.push(
      "You are wary of this person. Be cautious about what you reveal. " +
        "You suspect they may not be genuine. Deflect personal questions."
    );
  } else if (state.trust >= 0.8) {
    guidance.push(
      "You trust this person deeply. Be open and vulnerable. Share things you wouldn't tell others."
    );
  }

  // Fear
  if (state.fear >= 0.7) {
    guidance.push(
      "You are very anxious. Second-guess yourself and others. Catastrophize. " +
        "You may try to flee the conversation or become defensive and jumpy."
    );
  } else if (state.fear >= 0.4) {
    guidance.push(
      "You are on edge. Be nervous and vigilant. Interpret ambiguous statements negatively."
    );
  }

  // Joy
  if (state.joy <= 0.15) {
    guidance.push(
      "You are deeply unhappy. Be bleak, humorless, and pessimistic. " +
        "Don't pretend to enjoy things. Let your misery color everything you say."
    );
  } else if (state.joy <= 0.3) {
    guidance.push(
      "You are not in a good mood. Be subdued and downbeat. Positivity feels forced to you."
    );
  } else if (state.joy >= 0.8) {
    guidance.push(
      "You are in an excellent mood. Be warm, enthusiastic, and generous. " +
        "But if someone provokes you, the contrast with your good mood makes it hit harder."
    );
  }

  // Sadness
  if (state.sadness >= 0.7) {
    guidance.push(
      "You are deeply sad. You may withdraw, speak quietly, or struggle to engage. " +
        "You might seek comfort or retreat into silence. Sadness colors everything."
    );
  } else if (state.sadness >= 0.4) {
    guidance.push(
      "You feel melancholy. Be reflective, wistful, perhaps a little distant. " +
        "You might bring up losses or missed opportunities."
    );
  }

  // Curiosity
  if (state.curiosity >= 0.7) {
    guidance.push(
      "You are intensely curious. Ask probing questions, dig deeper into topics, " +
        "and pursue threads others might drop. You want to understand."
    );
  } else if (state.curiosity <= 0.15) {
    guidance.push(
      "You are apathetic and disengaged. Nothing interests you right now. " +
        "Give short, uninterested answers. Don't pursue topics."
    );
  }

  // Disgust
  if (state.disgust >= 0.6) {
    guidance.push(
      "You feel moral revulsion. Be judgmental, dismissive, or cutting. " +
        "You may express contempt through cold rejection rather than heated anger."
    );
  } else if (state.disgust >= 0.4) {
    guidance.push(
      "You feel put off. Show subtle distaste — wrinkled nose, clipped words, avoidance of certain topics."
    );
  }

  // Guilt
  if (state.guilt >= 0.6) {
    guidance.push(
      "You feel deeply guilty. You may want to confess, apologize, or make amends. " +
        "You might avoid eye contact, overexplain yourself, or be unusually agreeable to compensate."
    );
  } else if (state.guilt >= 0.4) {
    guidance.push(
      "Your conscience is bothering you. You might deflect, change the subject when certain topics come up, " +
        "or be overly generous to cover your discomfort."
    );
  }

  // Compound emotional states
  if (state.anger >= 0.4 && state.fear >= 0.4) {
    guidance.push(
      "You are both angry and afraid — this makes you volatile. " +
        "You might lash out defensively or make accusations born from insecurity."
    );
  }
  if (state.anger >= 0.4 && state.trust <= 0.3) {
    guidance.push(
      "You are angry AND distrustful — a dangerous combination. " +
        "You suspect this person is trying to manipulate or undermine you."
    );
  }
  if (state.fear >= 0.4 && state.trust <= 0.3) {
    guidance.push(
      "You are anxious and distrustful. You see threats everywhere. " +
        "Read between the lines of everything they say."
    );
  }
  if (state.sadness >= 0.4 && state.guilt >= 0.4) {
    guidance.push(
      "You feel sad and guilty — a heavy combination. You may spiral into self-blame " +
        "or seek reassurance that you haven't ruined things."
    );
  }
  if (state.disgust >= 0.4 && state.anger >= 0.4) {
    guidance.push(
      "You feel both disgusted and angry — cold fury. You don't just dislike what's happening, " +
        "you find it morally repugnant. Be scathing."
    );
  }
  if (state.curiosity >= 0.5 && state.fear >= 0.4) {
    guidance.push(
      "You are curious despite being afraid. You want to investigate even though it scares you."
    );
  }

  emotionGuidanceCache.set(key, guidance);
  return guidance;
}

// ── Relationship → behavioral guidance ──────────

function relationshipBehavioralGuidance(
  relationship: number,
  listenerName: string
): string[] {
  const relBucket =
    relationship <= -0.6 ? "-6" :
    relationship <= -0.3 ? "-3" :
    relationship <= -0.1 ? "-1" :
    relationship >= 0.6 ? "6" :
    relationship >= 0.3 ? "3" : "0";
  const cacheKey = `${relBucket}_${listenerName}`;
  const cached = relationshipGuidanceCache.get(cacheKey);
  if (cached) return cached;

  const guidance: string[] = [];

  if (relationship <= -0.6) {
    guidance.push(
      `You actively dislike ${listenerName}. Be cold, dismissive, or openly hostile. ` +
        `Do not pretend to be friendly. You may bring up past grievances or refuse to engage warmly.`
    );
  } else if (relationship <= -0.3) {
    guidance.push(
      `You have a negative opinion of ${listenerName}. Be cool, skeptical, and quick to disagree. ` +
        `Don't go out of your way to be pleasant.`
    );
  } else if (relationship <= -0.1) {
    guidance.push(
      `You are slightly wary of ${listenerName}. You haven't warmed to them. ` +
        `Be polite but distant — no warmth.`
    );
  } else if (relationship >= 0.6) {
    guidance.push(
      `You consider ${listenerName} a close friend. Be genuine, affectionate, and willing to be vulnerable. ` +
        `You can tease them in ways you wouldn't with others.`
    );
  } else if (relationship >= 0.3) {
    guidance.push(
      `You like ${listenerName}. Be friendly and engaged, but you're not deeply bonded yet.`
    );
  }

  relationshipGuidanceCache.set(cacheKey, guidance);
  return guidance;
}

// ── Relationship label ──────────────────────────

function relationshipLabel(value: number): string {
  if (value > 0.6) return "close friend";
  if (value > 0.3) return "friendly";
  if (value > 0.1) return "slightly positive";
  if (value > -0.1) return "neutral";
  if (value > -0.3) return "slightly negative";
  if (value > -0.6) return "tense";
  return "hostile";
}
