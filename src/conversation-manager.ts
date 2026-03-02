import type {
  NPC,
  ConversationMessage,
  ConversationSession,
  ActivityEvent,
  LLMResponse,
  ConversationType,
} from "./types";
import type { NpcStore } from "./npc-store";
import type { WorldSimulation } from "./world-simulation";
import { buildConversationMessages, buildReflectionMessages } from "./prompt-builder";
import { accumulateChat } from "./ollama";
import { parseLLMResponse, extractJson } from "./response-parser";

export interface ConversationManagerCallbacks {
  onStreamToken: (npcId: string, fullText: string) => void;
  onTurnComplete: (msg: ConversationMessage) => void;
  onConversationStart: (session: ConversationSession) => void;
  onConversationEnd: (session: ConversationSession) => void;
  onActivity: (event: ActivityEvent) => void;
  onSpeakerChange: (npcId: string | null) => void;
}

export class ConversationManager {
  private running = false;
  private paused = false;
  private activeSession: ConversationSession | null = null;
  private abortController: AbortController | null = null;
  private cooldowns: Map<string, number> = new Map();
  private lastConversationEnd = 0;

  private readonly MAX_TURNS = 6;
  private readonly COOLDOWN_MS = 30_000;
  private readonly GLOBAL_COOLDOWN_MS = 5_000;
  private readonly MIN_TURN_DURATION_MS = 1_500;

  private worldSim: WorldSimulation | null = null;
  private conversationEavesdroppers: Set<string> = new Set();

  constructor(
    private store: NpcStore,
    private callbacks: ConversationManagerCallbacks
  ) {}

  setWorldSimulation(world: WorldSimulation): void {
    this.worldSim = world;
  }

  // ── Lifecycle ────────────────────────────────

  start(): void {
    this.running = true;
    this.paused = false;
    this.log("Conversation engine started");
  }

  pause(): void {
    this.paused = true;
    this.log("Simulation paused");
  }

  resume(): void {
    this.paused = false;
    this.log("Simulation resumed");
  }

  stop(): void {
    this.running = false;
    this.paused = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.activeSession) {
      this.activeSession.status = "aborted";
      this.callbacks.onConversationEnd(this.activeSession);
      this.activeSession = null;
    }
    this.callbacks.onSpeakerChange(null);
    this.log("Conversation engine stopped");
  }

  isActive(): boolean {
    return this.activeSession !== null;
  }

  forceConversation(npcAId: string, npcBId: string): void {
    if (this.activeSession || !this.running) return;
    this.runConversation(npcAId, npcBId);
  }

  triggerConversation(npcAId: string, npcBId: string): void {
    if (this.activeSession || !this.running || this.paused) return;

    const now = Date.now();
    if (now - this.lastConversationEnd < this.GLOBAL_COOLDOWN_MS) return;

    const pKey = this.pairKey(npcAId, npcBId);
    const lastTime = this.cooldowns.get(pKey) ?? 0;
    if (now - lastTime < this.COOLDOWN_MS) return;

    this.runConversation(npcAId, npcBId);
  }

  private pairKey(a: string, b: string): string {
    return [a, b].sort().join(":");
  }

  // ── Conversation ─────────────────────────────

  private async runConversation(
    npcAId: string,
    npcBId: string
  ): Promise<void> {
    const npcA = this.store.get(npcAId);
    const npcB = this.store.get(npcBId);
    if (!npcA || !npcB) return;

    this.abortController = new AbortController();

    const session: ConversationSession = {
      id: `conv_${Date.now()}`,
      participantIds: [npcAId, npcBId],
      messages: [],
      turnCount: 0,
      maxTurns: this.MAX_TURNS,
      status: "active",
      startedAt: Date.now(),
    };

    this.activeSession = session;
    this.conversationEavesdroppers.clear();
    this.store.recordRelationshipSnapshot(npcAId, npcBId);
    const convType = this.classifyConversationType(npcA, npcB);
    this.callbacks.onConversationStart(session);
    this.log(`Conversation started between ${npcA.name} and ${npcB.name} [${convType}]`);

    const speakers = [npcA, npcB];
    let consecutiveFailures = 0;

    let speakerIndex = 0;
    let turnsCompleted = 0;
    while (turnsCompleted < this.MAX_TURNS) {
      if (!this.running || session.status !== "active") break;

      // Wait while paused
      while (this.paused && this.running) {
        await this.sleep(200);
      }
      if (!this.running) break;

      const speaker = speakers[speakerIndex % 2];
      const listener = speakers[(speakerIndex + 1) % 2];

      const turnStart = Date.now();
      const msg = await this.executeTurn(speaker, listener, session);

      if (!msg) {
        consecutiveFailures++;
        if (consecutiveFailures >= 2) {
          this.log("Two consecutive failures, ending conversation");
          break;
        }
        // Don't advance speaker — let the other NPC try next
        speakerIndex++;
        continue;
      }

      consecutiveFailures = 0;
      speakerIndex++;
      turnsCompleted++;

      if (msg.rawResponse?.conversation_end) {
        this.log(`${speaker.name} ended the conversation`);
        break;
      }

      if (turnsCompleted < this.MAX_TURNS) {
        const elapsed = Date.now() - turnStart;
        const remaining = this.MIN_TURN_DURATION_MS - elapsed;
        if (remaining > 0) {
          await this.sleep(remaining);
        }
      }
    }

    session.status = "completed";
    this.store.recordRelationshipSnapshot(npcAId, npcBId);
    this.activeSession = null;
    this.lastConversationEnd = Date.now();
    this.cooldowns.set(this.pairKey(npcAId, npcBId), Date.now());
    this.callbacks.onSpeakerChange(null);
    this.callbacks.onConversationEnd(session);
    this.log(
      `Conversation ended between ${npcA.name} and ${npcB.name} (${session.turnCount} turns)`
    );

    // Decay emotions toward baseline for both participants
    this.store.batch(() => {
      this.store.decayEmotions(npcAId);
      this.store.decayEmotions(npcBId);
      this.store.decayAllMemoryRecency();
    });

    // Log post-conversation summary
    this.logConversationSummary(npcAId, npcBId);

    // Emotional contagion: nearby NPCs feel the vibe
    this.applyEmotionalContagion(npcAId, npcBId, session);

    // Fire-and-forget inner monologue reflections
    this.runPostConversationReflection(npcAId, npcBId, session).catch(
      () => {}
    );
  }

  private async executeTurn(
    speaker: NPC,
    listener: NPC,
    session: ConversationSession
  ): Promise<ConversationMessage | null> {
    this.callbacks.onSpeakerChange(speaker.id);
    this.log(`${speaker.name} is thinking...`);

    // Re-read NPC state (may have changed from previous turn effects)
    const currentSpeaker = this.store.get(speaker.id)!;
    const currentListener = this.store.get(listener.id)!;

    const allNpcs = this.store
      .getAll()
      .map((n) => ({ id: n.id, name: n.name }));

    // Build trajectory context
    const velocity = this.store.getRelationshipVelocity(
      speaker.id,
      listener.id
    );
    let trajectoryContext: string | undefined;
    if (velocity.values.length >= 2) {
      const descriptor =
        velocity.trend === "improving"
          ? "warming up"
          : velocity.trend === "declining"
            ? "deteriorating"
            : "stable";
      trajectoryContext = `Your relationship with ${listener.name} has been ${descriptor} over your last ${velocity.values.length} encounters.`;
    }

    // Get location context
    const nearWp = this.worldSim?.getNearestWaypoint(speaker.id);
    const locationContext = nearWp?.description;

    const preSortedMemories = this.store.getSortedShortTermMemory(speaker.id);

    const messages = buildConversationMessages(
      currentSpeaker,
      currentListener,
      session,
      { allNpcs, trajectoryContext, locationContext, preSortedMemories }
    );

    let raw: string;
    try {
      raw = await accumulateChat(
        messages,
        (progress) => {
          this.callbacks.onStreamToken(speaker.id, progress);
        },
        this.abortController!.signal
      );
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
      this.log(`LLM error for ${speaker.name}: ${e}`);
      return null;
    }

    let response: LLMResponse;
    try {
      response = parseLLMResponse(raw);
    } catch {
      this.log(`Parse error for ${speaker.name}, retrying...`);

      // Retry with corrective prompt
      messages.push({ role: "assistant", content: raw });
      messages.push({
        role: "user",
        content:
          "Your previous response was not valid JSON. Please respond with ONLY a JSON object matching the required format. No other text.",
      });

      try {
        const retryRaw = await accumulateChat(
          messages,
          undefined,
          this.abortController!.signal
        );
        response = parseLLMResponse(retryRaw);
      } catch {
        this.log(`Retry failed for ${speaker.name}. Skipping turn.`);
        return null;
      }
    }

    // Apply side effects and log social dynamics (batched to single re-render)
    this.store.batch(() => {
      this.applyTurnEffects(currentSpeaker, currentListener, response);
    });

    const msg: ConversationMessage = {
      npcId: speaker.id,
      npcName: speaker.name,
      text: response.speech,
      intent: response.intent,
      rawResponse: response,
    };

    session.messages.push(msg);
    session.turnCount++;

    this.callbacks.onTurnComplete(msg);
    this.callbacks.onStreamToken(speaker.id, "");

    // Log the rich social details
    if (response.intent) {
      this.log(`${speaker.name}'s intent: ${response.intent}`);
    }

    this.logEmotionShifts(speaker.name, response);
    this.logRelationshipShift(speaker, listener, response);

    // Eavesdropping: 50% chance per turn, check nearby NPCs
    if (this.worldSim && Math.random() < 0.5) {
      this.checkEavesdroppers(speaker, listener, response);
    }

    return msg;
  }

  private applyTurnEffects(
    speaker: NPC,
    listener: NPC,
    response: LLMResponse
  ): void {
    this.store.applyEmotionDelta(speaker.id, response.emotion_delta);

    this.store.applyRelationshipDelta(
      speaker.id,
      listener.id,
      response.relationship_delta
    );

    // Listener gets dampened mirror of relationship delta
    this.store.applyRelationshipDelta(
      listener.id,
      speaker.id,
      response.relationship_delta * 0.5
    );

    const emotionMagnitude =
      Math.abs(response.emotion_delta.anger) +
      Math.abs(response.emotion_delta.trust) +
      Math.abs(response.emotion_delta.fear) +
      Math.abs(response.emotion_delta.joy);

    const speakerMemory = `I said to ${listener.name}: "${response.speech}"`;
    const listenerMemory = `${speaker.name} said to me: "${response.speech}"`;

    const sentimentValue =
      response.relationship_delta > 0
        ? 0.3
        : response.relationship_delta < 0
          ? -0.3
          : 0;

    // Speaker memory
    this.store.addMemory(
      speaker.id,
      {
        text: speakerMemory,
        importance: Math.min(1, Math.abs(response.relationship_delta) * 10),
        recency: 1,
        emotionalWeight: Math.min(1, emotionMagnitude),
        involvedNpcIds: [listener.id],
        timestamp: Date.now(),
        type: "conversation",
        aboutNpcIds: [],
        sentiment: sentimentValue,
      },
      "shortTermMemory"
    );

    // Listener memory
    this.store.addMemory(
      listener.id,
      {
        text: listenerMemory,
        importance: Math.min(1, Math.abs(response.relationship_delta) * 10),
        recency: 1,
        emotionalWeight: Math.min(1, emotionMagnitude * 0.5),
        involvedNpcIds: [speaker.id],
        timestamp: Date.now(),
        type: "conversation",
        aboutNpcIds: [],
        sentiment: sentimentValue,
      },
      "shortTermMemory"
    );

    // Secret reveals
    if (response.secret_revealed) {
      const matchedSecret = speaker.secrets.find((s) =>
        s.toLowerCase().includes(
          response.secret_revealed!.toLowerCase().slice(0, 30)
        )
      );

      if (matchedSecret) {
        this.store.addKnownSecret(listener.id, speaker.id, matchedSecret);

        this.store.addMemory(
          speaker.id,
          {
            text: `I revealed a secret to ${listener.name}: "${matchedSecret}"`,
            importance: 0.9,
            recency: 1,
            emotionalWeight: 0.8,
            involvedNpcIds: [listener.id],
            aboutNpcIds: [speaker.id],
            type: "secret_learned",
            sentiment: 0,
            timestamp: Date.now(),
          },
          "longTermMemory"
        );

        this.store.addMemory(
          listener.id,
          {
            text: `${speaker.name} confided in me: "${matchedSecret}"`,
            importance: 0.9,
            recency: 1,
            emotionalWeight: 0.8,
            involvedNpcIds: [speaker.id],
            aboutNpcIds: [speaker.id],
            type: "secret_learned",
            sentiment: 0,
            timestamp: Date.now(),
          },
          "longTermMemory"
        );

        this.log(`${speaker.name} revealed a secret to ${listener.name}!`);
      }
    }

    // Promises
    if (response.promise) {
      this.store.addPromise({
        id: `promise_${Date.now()}`,
        promiserId: speaker.id,
        promiseeId: listener.id,
        text: response.promise,
        madeAt: Date.now(),
        status: "active",
      });

      this.store.addMemory(
        speaker.id,
        {
          text: `I promised ${listener.name}: "${response.promise}"`,
          importance: 0.7,
          recency: 1,
          emotionalWeight: 0.5,
          involvedNpcIds: [listener.id],
          type: "promise_made",
          timestamp: Date.now(),
        },
        "shortTermMemory"
      );

      this.store.addMemory(
        listener.id,
        {
          text: `${speaker.name} promised me: "${response.promise}"`,
          importance: 0.7,
          recency: 1,
          emotionalWeight: 0.5,
          involvedNpcIds: [speaker.id],
          type: "promise_made",
          timestamp: Date.now(),
        },
        "shortTermMemory"
      );

      this.log(
        `${speaker.name} made a promise to ${listener.name}: "${response.promise}"`
      );
    }

    // Gossip: only create a memory for the LISTENER (the speaker already knows what they said)
    if (response.mentioned_npcs?.length) {
      for (const mention of response.mentioned_npcs) {
        // Validate the mentioned NPC exists
        if (!this.store.get(mention.npc_id)) continue;

        const mentionedName = this.npcName(mention.npc_id);

        this.store.addMemory(
          listener.id,
          {
            text: `${speaker.name} told me about ${mentionedName}: "${mention.what_was_said}"`,
            importance: 0.5,
            recency: 1,
            emotionalWeight: Math.abs(mention.sentiment) * 0.5,
            involvedNpcIds: [speaker.id],
            aboutNpcIds: [mention.npc_id],
            type: "gossip",
            sentiment: mention.sentiment,
            timestamp: Date.now(),
          },
          "shortTermMemory"
        );

        this.log(`${speaker.name} gossiped about ${mentionedName} to ${listener.name}`);
      }
    }

    // Log memory formation
    const speakerMems = this.store.get(speaker.id)?.shortTermMemory.length ?? 0;
    const listenerMems = this.store.get(listener.id)?.shortTermMemory.length ?? 0;
    this.log(`Memory stored for ${speaker.name} (${speakerMems} memories) and ${listener.name} (${listenerMems} memories)`);
  }

  // ── Rich social logging ──────────────────────

  private logEmotionShifts(name: string, response: LLMResponse): void {
    const d = response.emotion_delta;
    const shifts: string[] = [];

    if (Math.abs(d.joy) >= 0.01) {
      shifts.push(d.joy > 0 ? `+joy` : `-joy`);
    }
    if (Math.abs(d.trust) >= 0.01) {
      shifts.push(d.trust > 0 ? `+trust` : `-trust`);
    }
    if (Math.abs(d.anger) >= 0.01) {
      shifts.push(d.anger > 0 ? `+anger` : `-anger`);
    }
    if (Math.abs(d.fear) >= 0.01) {
      shifts.push(d.fear > 0 ? `+fear` : `-fear`);
    }

    if (shifts.length > 0) {
      // Read back the resulting emotional state
      const npc = this.store.get(
        // find the NPC by name — we have the store
        this.store.getAll().find((n) => n.name === name)?.id ?? ""
      );
      if (npc) {
        const mood = this.describeMood(npc);
        this.log(`${name} feels ${shifts.join(", ")} → now ${mood}`);
      }
    }
  }

  private logRelationshipShift(
    speaker: NPC,
    listener: NPC,
    response: LLMResponse
  ): void {
    if (Math.abs(response.relationship_delta) < 0.005) return;

    const arrow = response.relationship_delta > 0 ? "warmed" : "cooled";
    const updatedSpeaker = this.store.get(speaker.id);
    const relValue = updatedSpeaker?.relationships[listener.id] ?? 0;
    const label = this.relationshipLabel(relValue);

    this.log(
      `${speaker.name} ${arrow} toward ${listener.name} (${relValue >= 0 ? "+" : ""}${relValue.toFixed(2)}, ${label})`
    );
  }

  private describeMood(npc: NPC): string {
    const s = npc.emotionalState;
    const parts: string[] = [];
    if (s.joy > 0.7) parts.push("very happy");
    else if (s.joy > 0.5) parts.push("pleased");
    if (s.anger > 0.6) parts.push("angry");
    else if (s.anger > 0.3) parts.push("irritated");
    if (s.fear > 0.6) parts.push("fearful");
    else if (s.fear > 0.3) parts.push("uneasy");
    if (s.trust > 0.7) parts.push("very trusting");
    else if (s.trust < 0.3) parts.push("wary");
    return parts.length > 0 ? parts.join(", ") : "calm";
  }

  private relationshipLabel(value: number): string {
    if (value > 0.5) return "close friend";
    if (value > 0.2) return "friendly";
    if (value > -0.2) return "neutral";
    if (value > -0.5) return "tense";
    return "hostile";
  }

  private logConversationSummary(npcAId: string, npcBId: string): void {
    const a = this.store.get(npcAId);
    const b = this.store.get(npcBId);
    if (!a || !b) return;

    const relAB = a.relationships[npcBId] ?? 0;
    const relBA = b.relationships[npcAId] ?? 0;
    const labelAB = this.relationshipLabel(relAB);
    const labelBA = this.relationshipLabel(relBA);

    this.log(
      `Status: ${a.name}→${b.name}: ${labelAB} (${relAB >= 0 ? "+" : ""}${relAB.toFixed(2)}) | ${b.name}→${a.name}: ${labelBA} (${relBA >= 0 ? "+" : ""}${relBA.toFixed(2)})`
    );

    const moodA = this.describeMood(a);
    const moodB = this.describeMood(b);
    this.log(`Mood: ${a.name} is ${moodA} | ${b.name} is ${moodB}`);
  }

  // ── Helpers ──────────────────────────────────

  private applyEmotionalContagion(
    npcAId: string,
    npcBId: string,
    session: ConversationSession
  ): void {
    if (!this.worldSim) return;

    // Calculate the conversation's emotional intensity
    let totalAnger = 0;
    let totalJoy = 0;
    let totalFear = 0;
    let turns = 0;

    for (const msg of session.messages) {
      const d = msg.rawResponse?.emotion_delta;
      if (!d) continue;
      totalAnger += Math.abs(d.anger);
      totalJoy += d.joy;
      totalFear += Math.abs(d.fear);
      turns++;
    }

    if (turns === 0) return;

    const avgAnger = totalAnger / turns;
    const avgJoy = totalJoy / turns;
    const avgFear = totalFear / turns;

    // Only apply contagion if the conversation had emotional intensity
    if (avgAnger < 0.03 && Math.abs(avgJoy) < 0.03 && avgFear < 0.03) return;

    const posA = this.worldSim.getNpcPosition(npcAId);
    const posB = this.worldSim.getNpcPosition(npcBId);
    const center = posA ?? posB;
    if (!center) return;

    const nearbyIds = this.worldSim.getNpcsWithinRange(center, 5, [
      npcAId,
      npcBId,
    ]);

    for (const nearbyId of nearbyIds) {
      const nearby = this.store.get(nearbyId);
      if (!nearby) continue;

      const nearbyPos = this.worldSim.getNpcPosition(nearbyId);
      if (!nearbyPos) continue;

      // Scale effect by proximity (closer = stronger)
      const dist =
        Math.abs(nearbyPos.x - center.x) + Math.abs(nearbyPos.y - center.y);
      const proximityScale = Math.max(0.2, 1 - dist / 5);

      const delta = {
        anger: 0,
        trust: 0,
        fear: avgAnger > 0.05 ? 0.03 * proximityScale : 0,
        joy: avgJoy > 0.03 ? 0.02 * proximityScale : avgJoy < -0.03 ? -0.01 * proximityScale : 0,
      };

      if (delta.fear === 0 && delta.joy === 0) continue;

      this.store.applyEmotionDelta(nearbyId, delta);

      const feeling =
        delta.fear > 0
          ? "sensed tension"
          : delta.joy > 0
            ? "felt a warm atmosphere"
            : "felt an uneasy vibe";

      this.callbacks.onActivity({
        timestamp: new Date(),
        text: `${nearby.name} ${feeling} nearby`,
        activityType: "eavesdrop",
      });
    }
  }

  private classifyConversationType(a: NPC, b: NPC): ConversationType {
    const relAB = a.relationships[b.id] ?? 0;
    const relBA = b.relationships[a.id] ?? 0;
    const avgRel = (relAB + relBA) / 2;
    const velocity = this.store.getRelationshipVelocity(a.id, b.id);

    // Confrontation: negative relationship + anger
    if (
      avgRel < -0.3 &&
      (a.emotionalState.anger > 0.4 || b.emotionalState.anger > 0.4)
    ) {
      return "confrontation";
    }

    // Reconciliation: was declining but latest value improved
    if (
      velocity.trend === "declining" &&
      velocity.values.length >= 3 &&
      velocity.values[velocity.values.length - 1] >
        velocity.values[velocity.values.length - 2]
    ) {
      return "reconciliation";
    }

    // Alliance forming: positive relationship + high trust
    if (
      avgRel > 0.4 &&
      (a.emotionalState.trust > 0.6 || b.emotionalState.trust > 0.6)
    ) {
      return "alliance_forming";
    }

    // Gossip session: one participant has gossip memories
    const aHasGossip = a.shortTermMemory.some((m) => m.type === "gossip");
    const bHasGossip = b.shortTermMemory.some((m) => m.type === "gossip");
    if (aHasGossip || bHasGossip) {
      return "gossip_session";
    }

    return "casual";
  }

  private checkEavesdroppers(
    speaker: NPC,
    listener: NPC,
    response: LLMResponse
  ): void {
    if (!this.worldSim) return;

    const speakerPos = this.worldSim.getNpcPosition(speaker.id);
    if (!speakerPos) return;

    const nearbyIds = this.worldSim.getNpcsWithinRange(speakerPos, 4, [
      speaker.id,
      listener.id,
    ]);

    for (const eavesdropperId of nearbyIds) {
      // One eavesdrop per NPC per conversation
      if (this.conversationEavesdroppers.has(eavesdropperId)) continue;
      this.conversationEavesdroppers.add(eavesdropperId);

      const eavesdropper = this.store.get(eavesdropperId);
      if (!eavesdropper) continue;

      this.store.addMemory(
        eavesdropperId,
        {
          text: `I overheard ${speaker.name} say to ${listener.name}: "${response.speech}"`,
          importance: 0.4,
          recency: 1,
          emotionalWeight: 0.3,
          involvedNpcIds: [speaker.id, listener.id],
          aboutNpcIds: [],
          type: "eavesdrop",
          sentiment:
            response.relationship_delta > 0
              ? 0.1
              : response.relationship_delta < 0
                ? -0.1
                : 0,
          timestamp: Date.now(),
        },
        "shortTermMemory"
      );

      this.callbacks.onActivity({
        timestamp: new Date(),
        text: `${eavesdropper.name} overheard ${speaker.name} talking to ${listener.name}`,
        activityType: "eavesdrop",
      });
    }
  }

  private async runPostConversationReflection(
    npcAId: string,
    npcBId: string,
    session: ConversationSession
  ): Promise<void> {
    const summary = session.messages
      .map((m) => `${m.npcName}: "${m.text}"`)
      .join("\n");

    const pairs: [string, string][] = [
      [npcAId, npcBId],
      [npcBId, npcAId],
    ];

    await Promise.all(
      pairs.map(async ([npcId, otherId]) => {
        const npc = this.store.get(npcId);
        const other = this.store.get(otherId);
        if (!npc || !other) return;

        try {
          const messages = buildReflectionMessages(npc, other.name, summary);
          const raw = await accumulateChat(messages);
          const json = extractJson(raw);
          const parsed = JSON.parse(json);
          const thought =
            typeof parsed.thought === "string" ? parsed.thought.trim() : null;
          if (!thought) return;

          this.store.addMemory(
            npc.id,
            {
              text: thought,
              importance: 0.6,
              recency: 1,
              emotionalWeight: 0.4,
              involvedNpcIds: [otherId],
              aboutNpcIds: [otherId],
              type: "inner_thought",
              sentiment: 0,
              timestamp: Date.now(),
            },
            "shortTermMemory"
          );

          this.callbacks.onActivity({
            timestamp: new Date(),
            text: `${npc.name} thinks: "${thought}"`,
            activityType: "thought",
            npcId: npc.id,
          });
        } catch {
          // Reflection is best-effort, skip on failure
        }
      })
    );
  }

  private npcName(id: string): string {
    return this.store.get(id)?.name ?? id;
  }

  private log(text: string): void {
    this.callbacks.onActivity({ timestamp: new Date(), text });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      // Allow abort to interrupt sleep
      this.abortController?.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
    });
  }
}
