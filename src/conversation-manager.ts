import type {
  NPC,
  ConversationMessage,
  ConversationSession,
  ActivityEvent,
  LLMResponse,
} from "./types";
import type { NpcStore } from "./npc-store";
import { buildConversationMessages } from "./prompt-builder";
import { accumulateChat } from "./ollama";
import { parseLLMResponse } from "./response-parser";

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
  private readonly TURN_PAUSE_MS = 1_000;

  constructor(
    private store: NpcStore,
    private callbacks: ConversationManagerCallbacks
  ) {}

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
    this.callbacks.onConversationStart(session);
    this.log(`Conversation started between ${npcA.name} and ${npcB.name}`);

    const speakers = [npcA, npcB];
    let consecutiveFailures = 0;

    for (let turn = 0; turn < this.MAX_TURNS; turn++) {
      if (!this.running || session.status !== "active") break;

      // Wait while paused
      while (this.paused && this.running) {
        await this.sleep(200);
      }
      if (!this.running) break;

      const speaker = speakers[turn % 2];
      const listener = speakers[(turn + 1) % 2];

      const msg = await this.executeTurn(speaker, listener, session);

      if (!msg) {
        consecutiveFailures++;
        if (consecutiveFailures >= 2) {
          this.log("Two consecutive failures, ending conversation");
          break;
        }
        continue;
      }

      consecutiveFailures = 0;

      if (msg.rawResponse?.conversation_end) {
        this.log(`${speaker.name} ended the conversation`);
        break;
      }

      if (turn < this.MAX_TURNS - 1) {
        await this.sleep(this.TURN_PAUSE_MS);
      }
    }

    session.status = "completed";
    this.activeSession = null;
    this.lastConversationEnd = Date.now();
    this.cooldowns.set(this.pairKey(npcAId, npcBId), Date.now());
    this.callbacks.onSpeakerChange(null);
    this.callbacks.onConversationEnd(session);
    this.log(
      `Conversation ended between ${npcA.name} and ${npcB.name} (${session.turnCount} turns)`
    );

    // Log post-conversation summary
    this.logConversationSummary(npcAId, npcBId);
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

    const messages = buildConversationMessages(
      currentSpeaker,
      currentListener,
      session
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

    // Apply side effects and log social dynamics
    this.applyTurnEffects(currentSpeaker, currentListener, response);

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
      },
      "shortTermMemory"
    );

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
