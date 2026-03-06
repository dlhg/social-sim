import type {
  NPC,
  ConversationMessage,
  ConversationSession,
  ActivityEvent,
  LLMResponse,
  ConversationType,
  ActionData,
  ActionType,
  FloaterData,
  FloaterCategory,
} from "./types";
import type { NpcStore } from "./npc-store";
import type { WorldSimulation } from "./world-simulation";
import type { DayCycle } from "./day-cycle";
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
  onFloater?: (floater: FloaterData) => void;
}

export class ConversationManager {
  private running = false;
  private paused = false;
  private activeSession: ConversationSession | null = null;
  private abortController: AbortController | null = null;
  private cooldowns: Map<string, number> = new Map();
  private lastConversationEnd = 0;

  private readonly MIN_TURNS = 3;
  private readonly MAX_TURNS = 18;
  private readonly COOLDOWN_MS = 30_000;
  private readonly GLOBAL_COOLDOWN_MS = 5_000;
  private readonly MIN_TURN_DURATION_MS = 1_500;

  private worldSim: WorldSimulation | null = null;
  private dayCycle: DayCycle | null = null;
  private conversationEavesdroppers: Set<string> = new Set();
  private language = "English";

  constructor(
    private store: NpcStore,
    private callbacks: ConversationManagerCallbacks
  ) {}

  setLanguage(language: string): void {
    this.language = language;
  }

  setWorldSimulation(world: WorldSimulation): void {
    this.worldSim = world;
  }

  setDayCycle(dayCycle: DayCycle): void {
    this.dayCycle = dayCycle;
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

  triggerConversation(npcAId: string, npcBId: string): boolean {
    if (this.activeSession || !this.running || this.paused) return false;

    const now = Date.now();
    if (now - this.lastConversationEnd < this.GLOBAL_COOLDOWN_MS) return false;

    const pKey = this.pairKey(npcAId, npcBId);
    const lastTime = this.cooldowns.get(pKey) ?? 0;
    if (now - lastTime < this.COOLDOWN_MS) return false;

    this.runConversation(npcAId, npcBId);
    return true;
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
      maxTurns: this.rollMaxTurns(),
      status: "active",
      startedAt: Date.now(),
    };

    this.activeSession = session;
    this.conversationEavesdroppers.clear();
    this.store.recordRelationshipSnapshot(npcAId, npcBId);
    const convType = this.classifyConversationType(npcA, npcB);
    this.callbacks.onConversationStart(session);
    this.log(`Conversation started between ${npcA.name} and ${npcB.name} [${convType}, max ${session.maxTurns} turns]`);

    const speakers = [npcA, npcB];
    let consecutiveFailures = 0;

    let speakerIndex = 0;
    let turnsCompleted = 0;
    while (turnsCompleted < session.maxTurns) {
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

      if (turnsCompleted < session.maxTurns) {
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

    // Post-conversation behavioral triggers (seek/avoid)
    this.triggerPostConversationBehavior(npcAId, npcBId, session);

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

    const timeOfDay = this.dayCycle?.getLabel();
    const pendingPlans = this.store.getPromisesFor(speaker.id)
      .filter(p => p.status === "active")
      .map(p => {
        const otherId = p.promiserId === speaker.id ? p.promiseeId : p.promiserId;
        const otherNpc = this.store.get(otherId);
        return { withName: otherNpc?.name ?? otherId, text: p.text };
      });

    const messages = buildConversationMessages(
      currentSpeaker,
      currentListener,
      session,
      { allNpcs, trajectoryContext, locationContext, preSortedMemories, language: this.language, timeOfDay, pendingPlans }
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

    // storm_off forces conversation end
    if (response.action?.action === "storm_off") {
      response.conversation_end = true;
    }

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

    this.logEmotionShifts(speaker, listener, response);
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
      const promise = {
        id: `promise_${Date.now()}`,
        promiserId: speaker.id,
        promiseeId: listener.id,
        text: response.promise,
        madeAt: Date.now(),
        status: "active" as const,
      };
      this.dayCycle?.assignResolvePhase(promise);
      this.store.addPromise(promise);

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

    // Actions
    if (response.action) {
      this.processAction(speaker, listener, response.action);
    }

    // Log memory formation
    const speakerMems = this.store.get(speaker.id)?.shortTermMemory.length ?? 0;
    const listenerMems = this.store.get(listener.id)?.shortTermMemory.length ?? 0;
    this.log(`Memory stored for ${speaker.name} (${speakerMems} memories) and ${listener.name} (${listenerMems} memories)`);
  }

  // ── Action Processing ───────────────────────

  private processAction(speaker: NPC, listener: NPC, action: ActionData): void {
    this.log(`${speaker.name} performs action: ${action.action}`);
    switch (action.action) {
      case "give_gift":
        this.processGiveGift(speaker, listener, action);
        break;
      case "mock":
        this.processMock(speaker, listener, action);
        break;
      case "storm_off":
        this.processStormOff(speaker, listener);
        break;
      case "embrace":
        this.processEmbrace(speaker, listener, action);
        break;
      case "threaten":
        this.processThreaten(speaker, listener, action);
        break;
      case "conspire":
        this.processConspire(speaker, listener, action);
        break;
      case "spread_rumor":
        this.processSpreadRumor(speaker, listener, action);
        break;
    }
  }

  private processGiveGift(speaker: NPC, listener: NPC, action: ActionData): void {
    const giftDesc = action.detail ?? "a small token";

    this.store.applyRelationshipDelta(speaker.id, listener.id, 0.15);
    this.store.applyRelationshipDelta(listener.id, speaker.id, 0.15);
    this.store.applyEmotionDelta(speaker.id, { anger: 0, trust: 0.05, fear: 0, joy: 0.1 });
    this.store.applyEmotionDelta(listener.id, { anger: 0, trust: 0.05, fear: 0, joy: 0.1 });

    this.store.addMemory(speaker.id, {
      text: `I gave ${listener.name} a gift: ${giftDesc}`,
      importance: 0.7, recency: 1, emotionalWeight: 0.6,
      involvedNpcIds: [listener.id], aboutNpcIds: [],
      type: "action_performed", sentiment: 0.5, timestamp: Date.now(),
    }, "shortTermMemory");

    this.store.addMemory(listener.id, {
      text: `${speaker.name} gave me a gift: ${giftDesc}`,
      importance: 0.7, recency: 1, emotionalWeight: 0.6,
      involvedNpcIds: [speaker.id], aboutNpcIds: [],
      type: "action_received", sentiment: 0.5, timestamp: Date.now(),
    }, "shortTermMemory");

    this.callbacks.onActivity({
      timestamp: new Date(),
      text: `${speaker.name} gave ${listener.name} a gift: ${giftDesc}`,
      activityType: "action",
      npcId: speaker.id,
    });

    this.notifyWitnesses(speaker, listener, "give_gift", giftDesc);
  }

  private processMock(speaker: NPC, listener: NPC, action: ActionData): void {
    const mockDetail = action.detail ?? "them";

    this.store.applyRelationshipDelta(speaker.id, listener.id, -0.1);
    this.store.applyRelationshipDelta(listener.id, speaker.id, -0.15);
    this.store.applyEmotionDelta(listener.id, { anger: 0.1, trust: -0.1, fear: 0, joy: -0.05 });
    this.store.applyEmotionDelta(speaker.id, { anger: 0, trust: 0, fear: 0, joy: 0.05 });

    this.store.addMemory(speaker.id, {
      text: `I publicly mocked ${listener.name}: ${mockDetail}`,
      importance: 0.6, recency: 1, emotionalWeight: 0.5,
      involvedNpcIds: [listener.id], aboutNpcIds: [listener.id],
      type: "action_performed", sentiment: -0.4, timestamp: Date.now(),
    }, "shortTermMemory");

    this.store.addMemory(listener.id, {
      text: `${speaker.name} publicly mocked me: ${mockDetail}`,
      importance: 0.8, recency: 1, emotionalWeight: 0.7,
      involvedNpcIds: [speaker.id], aboutNpcIds: [listener.id],
      type: "action_received", sentiment: -0.6, timestamp: Date.now(),
    }, "shortTermMemory");

    this.callbacks.onActivity({
      timestamp: new Date(),
      text: `${speaker.name} mocked ${listener.name}: ${mockDetail}`,
      activityType: "action",
      npcId: speaker.id,
    });

    this.notifyWitnesses(speaker, listener, "mock", mockDetail);
  }

  private processStormOff(speaker: NPC, listener: NPC): void {
    this.store.applyRelationshipDelta(speaker.id, listener.id, -0.1);
    this.store.applyRelationshipDelta(listener.id, speaker.id, -0.05);
    this.store.applyEmotionDelta(speaker.id, { anger: 0.05, trust: -0.05, fear: 0, joy: -0.05 });
    this.store.applyEmotionDelta(listener.id, { anger: 0.05, trust: -0.05, fear: 0, joy: -0.05 });

    this.store.setBehavioralOverride(speaker.id, {
      mode: "avoid",
      targetNpcId: listener.id,
      expiresAt: Date.now() + 120_000,
      reason: `Stormed off from conversation with ${listener.name}`,
    });

    this.store.addMemory(speaker.id, {
      text: `I stormed off from my conversation with ${listener.name}`,
      importance: 0.7, recency: 1, emotionalWeight: 0.6,
      involvedNpcIds: [listener.id], aboutNpcIds: [],
      type: "action_performed", sentiment: -0.3, timestamp: Date.now(),
    }, "shortTermMemory");

    this.store.addMemory(listener.id, {
      text: `${speaker.name} stormed off during our conversation`,
      importance: 0.7, recency: 1, emotionalWeight: 0.6,
      involvedNpcIds: [speaker.id], aboutNpcIds: [],
      type: "action_received", sentiment: -0.3, timestamp: Date.now(),
    }, "shortTermMemory");

    this.callbacks.onActivity({
      timestamp: new Date(),
      text: `${speaker.name} stormed off from ${listener.name}!`,
      activityType: "action",
      npcId: speaker.id,
    });

    this.notifyWitnesses(speaker, listener, "storm_off", "");
  }

  private processEmbrace(speaker: NPC, listener: NPC, action: ActionData): void {
    const desc = action.detail ?? "a warm embrace";

    this.store.applyRelationshipDelta(speaker.id, listener.id, 0.15);
    this.store.applyRelationshipDelta(listener.id, speaker.id, 0.15);
    this.store.applyEmotionDelta(speaker.id, { anger: -0.05, trust: 0.1, fear: -0.05, joy: 0.1 });
    this.store.applyEmotionDelta(listener.id, { anger: -0.05, trust: 0.1, fear: -0.05, joy: 0.1 });

    this.store.addMemory(speaker.id, {
      text: `I embraced ${listener.name}: ${desc}`,
      importance: 0.7, recency: 1, emotionalWeight: 0.7,
      involvedNpcIds: [listener.id], aboutNpcIds: [],
      type: "action_performed", sentiment: 0.6, timestamp: Date.now(),
    }, "shortTermMemory");

    this.store.addMemory(listener.id, {
      text: `${speaker.name} embraced me: ${desc}`,
      importance: 0.7, recency: 1, emotionalWeight: 0.7,
      involvedNpcIds: [speaker.id], aboutNpcIds: [],
      type: "action_received", sentiment: 0.6, timestamp: Date.now(),
    }, "shortTermMemory");

    this.callbacks.onActivity({
      timestamp: new Date(),
      text: `${speaker.name} embraced ${listener.name}`,
      activityType: "action",
      npcId: speaker.id,
    });

    this.notifyWitnesses(speaker, listener, "embrace", desc);
  }

  private processThreaten(speaker: NPC, listener: NPC, action: ActionData): void {
    const threat = action.detail ?? "an unspecified threat";

    this.store.applyRelationshipDelta(listener.id, speaker.id, -0.15);
    this.store.applyRelationshipDelta(speaker.id, listener.id, -0.05);
    this.store.applyEmotionDelta(listener.id, { anger: 0.05, trust: -0.1, fear: 0.15, joy: -0.05 });

    // If listener is already fearful, trigger avoid behavior
    const listenerState = this.store.get(listener.id);
    if (listenerState && listenerState.emotionalState.fear > 0.5) {
      this.store.setBehavioralOverride(listener.id, {
        mode: "avoid",
        targetNpcId: speaker.id,
        expiresAt: Date.now() + 90_000,
        reason: `Threatened by ${speaker.name}: ${threat}`,
      });
    }

    this.store.addMemory(speaker.id, {
      text: `I threatened ${listener.name}: ${threat}`,
      importance: 0.8, recency: 1, emotionalWeight: 0.7,
      involvedNpcIds: [listener.id], aboutNpcIds: [listener.id],
      type: "action_performed", sentiment: -0.5, timestamp: Date.now(),
    }, "shortTermMemory");

    // Threats go to long-term memory for the recipient
    this.store.addMemory(listener.id, {
      text: `${speaker.name} threatened me: ${threat}`,
      importance: 0.9, recency: 1, emotionalWeight: 0.9,
      involvedNpcIds: [speaker.id], aboutNpcIds: [listener.id],
      type: "action_received", sentiment: -0.7, timestamp: Date.now(),
    }, "longTermMemory");

    this.callbacks.onActivity({
      timestamp: new Date(),
      text: `${speaker.name} threatened ${listener.name}: "${threat}"`,
      activityType: "action",
      npcId: speaker.id,
    });

    this.notifyWitnesses(speaker, listener, "threaten", threat);
  }

  private processConspire(speaker: NPC, listener: NPC, action: ActionData): void {
    const targetId = action.target_npc_id;
    if (!targetId || !this.store.get(targetId)) return;

    const targetName = this.npcName(targetId);
    const plan = action.detail ?? "an unspecified scheme";

    this.store.applyRelationshipDelta(speaker.id, listener.id, 0.1);
    this.store.applyRelationshipDelta(listener.id, speaker.id, 0.1);
    this.store.applyRelationshipDelta(speaker.id, targetId, -0.05);
    this.store.applyRelationshipDelta(listener.id, targetId, -0.05);

    this.store.addMemory(speaker.id, {
      text: `I conspired with ${listener.name} against ${targetName}: ${plan}`,
      importance: 0.85, recency: 1, emotionalWeight: 0.7,
      involvedNpcIds: [listener.id], aboutNpcIds: [targetId],
      type: "alliance", sentiment: -0.5, timestamp: Date.now(),
    }, "longTermMemory");

    this.store.addMemory(listener.id, {
      text: `${speaker.name} proposed a conspiracy against ${targetName}: ${plan}`,
      importance: 0.85, recency: 1, emotionalWeight: 0.7,
      involvedNpcIds: [speaker.id], aboutNpcIds: [targetId],
      type: "alliance", sentiment: -0.5, timestamp: Date.now(),
    }, "longTermMemory");

    this.callbacks.onActivity({
      timestamp: new Date(),
      text: `${speaker.name} and ${listener.name} conspired against ${targetName}`,
      activityType: "action",
      npcId: speaker.id,
    });

    // Conspire is private — not witnessed, but caught by existing eavesdrop system
  }

  private processSpreadRumor(speaker: NPC, listener: NPC, action: ActionData): void {
    const targetId = action.target_npc_id;
    if (!targetId || !this.store.get(targetId)) return;

    const targetName = this.npcName(targetId);
    const rumor = action.detail ?? "something unspecified";

    this.store.addMemory(listener.id, {
      text: `${speaker.name} told me something about ${targetName}: "${rumor}"`,
      importance: 0.6, recency: 1, emotionalWeight: 0.4,
      involvedNpcIds: [speaker.id], aboutNpcIds: [targetId],
      type: "rumor_planted", sentiment: -0.3, timestamp: Date.now(),
    }, "shortTermMemory");

    this.store.addMemory(speaker.id, {
      text: `I spread a rumor about ${targetName} to ${listener.name}: "${rumor}"`,
      importance: 0.5, recency: 1, emotionalWeight: 0.3,
      involvedNpcIds: [listener.id], aboutNpcIds: [targetId],
      type: "action_performed", sentiment: -0.2, timestamp: Date.now(),
    }, "shortTermMemory");

    this.store.applyRelationshipDelta(listener.id, targetId, -0.1);

    this.callbacks.onActivity({
      timestamp: new Date(),
      text: `${speaker.name} spread a rumor to ${listener.name} about ${targetName}`,
      activityType: "action",
      npcId: speaker.id,
    });

    // Rumors are private — not witnessed, caught by existing eavesdrop system
  }

  // ── Witness System ─────────────────────────

  private notifyWitnesses(
    speaker: NPC,
    listener: NPC,
    actionType: ActionType,
    detail: string
  ): void {
    if (!this.worldSim) return;

    const speakerPos = this.worldSim.getNpcPosition(speaker.id);
    if (!speakerPos) return;

    const nearbyIds = this.worldSim.getNpcsWithinRange(speakerPos, 5, [
      speaker.id,
      listener.id,
    ]);

    for (const witnessId of nearbyIds) {
      const witness = this.store.get(witnessId);
      if (!witness) continue;

      let memoryText: string;
      let emotionDelta = { anger: 0, trust: 0, fear: 0, joy: 0 };
      let sentiment = 0;

      switch (actionType) {
        case "give_gift": {
          memoryText = `I saw ${speaker.name} give ${listener.name} a gift: ${detail}`;
          sentiment = 0.2;
          const witRel = witness.relationships[speaker.id] ?? 0;
          if (witRel > 0.3) {
            emotionDelta = { anger: 0.03, trust: 0, fear: 0, joy: -0.02 };
            sentiment = -0.1; // mild jealousy
          } else {
            emotionDelta = { anger: 0, trust: 0, fear: 0, joy: 0.02 };
          }
          break;
        }
        case "mock": {
          memoryText = `I saw ${speaker.name} mock ${listener.name}: ${detail}`;
          sentiment = -0.3;
          this.store.applyRelationshipDelta(witnessId, speaker.id, -0.05);
          const witRelToVictim = witness.relationships[listener.id] ?? 0;
          if (witRelToVictim > -0.1) {
            this.store.applyRelationshipDelta(witnessId, listener.id, 0.03);
          }
          emotionDelta = { anger: 0.03, trust: -0.02, fear: 0.02, joy: -0.02 };
          break;
        }
        case "storm_off":
          memoryText = `I saw ${speaker.name} storm off from ${listener.name}`;
          sentiment = -0.2;
          emotionDelta = { anger: 0, trust: 0, fear: 0.03, joy: -0.02 };
          break;

        case "embrace": {
          memoryText = `I saw ${speaker.name} embrace ${listener.name}`;
          sentiment = 0.3;
          const witRelS = witness.relationships[speaker.id] ?? 0;
          const witRelL = witness.relationships[listener.id] ?? 0;
          if (witRelS > 0.4 || witRelL > 0.4) {
            emotionDelta = { anger: 0.03, trust: -0.02, fear: 0, joy: -0.03 };
            sentiment = -0.15; // jealousy
            memoryText += " — I felt a pang of jealousy";
          } else {
            emotionDelta = { anger: 0, trust: 0, fear: 0, joy: 0.02 };
          }
          break;
        }
        case "threaten":
          memoryText = `I saw ${speaker.name} threaten ${listener.name}: ${detail}`;
          sentiment = -0.4;
          this.store.applyRelationshipDelta(witnessId, speaker.id, -0.08);
          emotionDelta = { anger: 0.02, trust: -0.05, fear: 0.08, joy: -0.03 };
          break;

        default:
          continue; // conspire and spread_rumor are not witnessed visually
      }

      this.store.applyEmotionDelta(witnessId, emotionDelta);

      this.store.addMemory(witnessId, {
        text: memoryText,
        importance: 0.6, recency: 1, emotionalWeight: 0.5,
        involvedNpcIds: [speaker.id, listener.id],
        aboutNpcIds: [speaker.id, listener.id],
        type: "action_witnessed",
        sentiment,
        timestamp: Date.now(),
      }, "shortTermMemory");
    }
  }

  // ── Post-Conversation Behavioral Triggers ──

  private triggerPostConversationBehavior(
    npcAId: string,
    npcBId: string,
    session: ConversationSession
  ): void {
    const npcA = this.store.get(npcAId);
    const npcB = this.store.get(npcBId);
    if (!npcA || !npcB) return;

    // If conspiracy happened, the non-initiating conspirator seeks the target
    for (const msg of session.messages) {
      if (msg.rawResponse?.action?.action === "conspire") {
        const targetId = msg.rawResponse.action.target_npc_id;
        if (targetId && this.store.get(targetId)) {
          const conspiratorId = msg.npcId === npcAId ? npcBId : npcAId;
          const existing = this.store.get(conspiratorId)?.behavioralOverride;
          if (!existing) {
            this.store.setBehavioralOverride(conspiratorId, {
              mode: "seek",
              targetNpcId: targetId,
              expiresAt: Date.now() + 90_000,
              reason: `Seeking ${this.npcName(targetId)} to act on conspiracy`,
            });
          }
        }
      }
    }

    // Very positive conversation → seek to stay near each other
    const relAB = npcA.relationships[npcBId] ?? 0;
    if (relAB > 0.6 && npcA.emotionalState.joy > 0.6 && !npcA.behavioralOverride) {
      this.store.setBehavioralOverride(npcAId, {
        mode: "seek",
        targetNpcId: npcBId,
        expiresAt: Date.now() + 45_000,
        reason: `Wants to stay near ${npcB.name} after a great conversation`,
      });
    }

    const relBA = npcB.relationships[npcAId] ?? 0;
    if (relBA > 0.6 && npcB.emotionalState.joy > 0.6 && !npcB.behavioralOverride) {
      this.store.setBehavioralOverride(npcBId, {
        mode: "seek",
        targetNpcId: npcAId,
        expiresAt: Date.now() + 45_000,
        reason: `Wants to stay near ${npcA.name} after a great conversation`,
      });
    }
  }

  // ── Rich social logging ──────────────────────

  private static readonly EMOTION_COLORS: Record<string, { pos: string; neg: string }> = {
    joy:   { pos: "#ffd54f", neg: "#b56576" },
    trust: { pos: "#66bb6a", neg: "#7a8ba0" },
    anger: { pos: "#ff7043", neg: "#4dd0e1" },
    fear:  { pos: "#ce93d8", neg: "#81d4fa" },
  };

  private logEmotionShifts(speaker: NPC, listener: NPC, response: LLMResponse): void {
    const d = response.emotion_delta;
    const shifts: string[] = [];

    const emotions: Array<{ key: string; val: number }> = [
      { key: "joy", val: d.joy },
      { key: "trust", val: d.trust },
      { key: "anger", val: d.anger },
      { key: "fear", val: d.fear },
    ];

    const active = emotions.filter(e => Math.abs(e.val) >= 0.01);
    const awayDir = this.awayDirection(speaker.id, listener.id);

    // Fan floaters out: alternate directions, spread vertically, vary drift
    for (let i = 0; i < active.length; i++) {
      const { key, val } = active[i];
      const label = val > 0 ? `+${key}` : `-${key}`;
      shifts.push(label);
      const colors = ConversationManager.EMOTION_COLORS[key];

      // First floater goes away from partner, subsequent alternate
      const dir: 1 | -1 = i % 2 === 0 ? awayDir : (-awayDir as 1 | -1);
      // Spread vertically: even indices go up, odd go down from center
      const ySpread = (i - (active.length - 1) / 2) * 14;
      // Vary drift distance so paths diverge further
      const drift = 0.8 + Math.random() * 0.5;

      this.emitFloater(
        speaker.id,
        label,
        val > 0 ? colors.pos : colors.neg,
        "emotion",
        { delay: i * 100, directionX: dir, offsetY: ySpread, driftScale: drift },
      );
    }

    if (shifts.length > 0) {
      const npc = this.store.get(speaker.id);
      if (npc) {
        const mood = this.describeMood(npc);
        this.log(`${speaker.name} feels ${shifts.join(", ")} → now ${mood}`);
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

    const isPositive = response.relationship_delta > 0;
    const symbol = isPositive ? "\u2665" : "\u2661"; // filled / hollow heart
    const floaterText = `${symbol} ${isPositive ? "+" : ""}${response.relationship_delta.toFixed(2)} ${listener.name}`;
    const awayDir = this.awayDirection(speaker.id, listener.id);
    this.emitFloater(
      speaker.id,
      floaterText,
      isPositive ? "#f48fb1" : "#78909c",
      "relationship",
      { delay: 2000, directionX: awayDir, offsetY: -8, driftScale: 1.1 },
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

  /**
   * Weighted random turn count: most conversations land 6-10,
   * short ones (3-5) and long ones (11-18) are rarer.
   */
  private rollMaxTurns(): number {
    // Sum of two dice-style rolls biased toward the middle
    const base = this.MIN_TURNS;
    const range = this.MAX_TURNS - this.MIN_TURNS; // 15
    // Average of two uniform randoms → triangular-ish distribution centered at ~10
    const r = (Math.random() + Math.random()) / 2;
    return base + Math.round(r * range);
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
          const messages = buildReflectionMessages(npc, other.name, summary, this.language);
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

  private floaterCounter = 0;

  /**
   * Determine the "away from partner" direction.
   * Returns 1 (right) or -1 (left).
   */
  private awayDirection(npcId: string, awayFromNpcId?: string): 1 | -1 {
    if (awayFromNpcId && this.worldSim) {
      const myPos = this.worldSim.getNpcPosition(npcId);
      const theirPos = this.worldSim.getNpcPosition(awayFromNpcId);
      if (myPos && theirPos) {
        const dx = theirPos.x - myPos.x;
        if (Math.abs(dx) > 0.5) return dx > 0 ? -1 : 1;
      }
    }
    return Math.random() < 0.5 ? 1 : -1;
  }

  private emitFloater(
    npcId: string,
    text: string,
    color: string,
    category: FloaterCategory,
    opts: {
      delay?: number;
      directionX?: 1 | -1;
      offsetY?: number;
      driftScale?: number;
    } = {},
  ): void {
    this.callbacks.onFloater?.({
      id: `fl-${Date.now()}-${this.floaterCounter++}`,
      npcId,
      text,
      color,
      category,
      spawnedAt: Date.now(),
      directionX: opts.directionX ?? (Math.random() < 0.5 ? 1 : -1),
      delay: opts.delay ?? 0,
      offsetY: opts.offsetY ?? 0,
      driftScale: opts.driftScale ?? 1,
    });
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
