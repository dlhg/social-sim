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
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private cooldowns: Map<string, number> = new Map();
  private lastConversationEnd = 0;

  private readonly MAX_TURNS = 6;
  private readonly COOLDOWN_MS = 30_000;
  private readonly GLOBAL_COOLDOWN_MS = 5_000;
  private readonly RANDOM_TRIGGER_CHANCE = 0.3;
  private readonly TICK_INTERVAL_MS = 2_000;
  private readonly TURN_PAUSE_MS = 1_000;

  constructor(
    private store: NpcStore,
    private callbacks: ConversationManagerCallbacks
  ) {}

  // ── Lifecycle ────────────────────────────────

  start(): void {
    this.running = true;
    this.paused = false;
    this.log("Simulation started");
    this.tickTimer = setInterval(() => this.tick(), this.TICK_INTERVAL_MS);
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
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
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
    this.log("Simulation stopped");
  }

  triggerConversation(npcAId?: string, npcBId?: string): void {
    if (this.activeSession || !this.running) return;

    let pair: [string, string] | null = null;
    if (npcAId && npcBId) {
      pair = [npcAId, npcBId];
    } else {
      pair = this.selectPair();
    }

    if (pair) {
      this.runConversation(pair[0], pair[1]);
    }
  }

  // ── Tick loop ────────────────────────────────

  private tick(): void {
    if (this.paused || this.activeSession || !this.running) return;
    if (Date.now() - this.lastConversationEnd < this.GLOBAL_COOLDOWN_MS) return;

    if (Math.random() < this.RANDOM_TRIGGER_CHANCE) {
      const pair = this.selectPair();
      if (pair) {
        this.runConversation(pair[0], pair[1]);
      }
    }
  }

  private selectPair(): [string, string] | null {
    const npcs = this.store.getAll();
    if (npcs.length < 2) return null;

    const now = Date.now();
    const candidates: [string, string][] = [];

    for (let i = 0; i < npcs.length; i++) {
      for (let j = i + 1; j < npcs.length; j++) {
        const pairKey = this.pairKey(npcs[i].id, npcs[j].id);
        const lastTime = this.cooldowns.get(pairKey) ?? 0;
        if (now - lastTime >= this.COOLDOWN_MS) {
          candidates.push([npcs[i].id, npcs[j].id]);
        }
      }
    }

    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
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

    // Apply side effects
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
    this.log(`${speaker.name} finished speaking`);

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

    // Speaker memory
    this.store.addMemory(
      speaker.id,
      {
        text: `I said to ${listener.name}: "${response.speech}"`,
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
        text: `${speaker.name} said to me: "${response.speech}"`,
        importance: Math.min(1, Math.abs(response.relationship_delta) * 10),
        recency: 1,
        emotionalWeight: Math.min(1, emotionMagnitude * 0.5),
        involvedNpcIds: [speaker.id],
        timestamp: Date.now(),
      },
      "shortTermMemory"
    );
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
