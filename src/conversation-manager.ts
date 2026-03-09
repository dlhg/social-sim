import type {
  NPC,
  ConversationMessage,
  ConversationSession,
  ActivityEvent,
  LLMResponse,
  ConversationType,
  BatchTurnData,
  ActionData,
  ActionType,
  FloaterData,
  FloaterCategory,
} from "./types";
import type { NpcStore } from "./npc-store";
import type { MemoryService } from "./memory-service";
import type { WorldSimulation } from "./world-simulation";
import type { DayCycle } from "./day-cycle";
import type { TTSService } from "./tts-service";
import { buildConversationMessages, buildBatchConversationMessages, buildReflectionMessages } from "./prompt-builder";
import { accumulateChat, getGroqRateLimits } from "./ollama";
import type { GroqRateLimits } from "./ollama";
import { loadLlmConfig, GROQ_MODELS } from "./llm-config";
import { parseLLMResponse, parseBatchLLMResponse, extractJson } from "./response-parser";

export interface ConversationManagerCallbacks {
  onStreamToken: (npcId: string, fullText: string) => void;
  onTurnComplete: (msg: ConversationMessage) => void;
  /** Fires after audio playback for a turn finishes (bubble should start fading now) */
  onTurnAudioEnd?: (npcId: string) => void;
  onConversationStart: (session: ConversationSession) => void;
  onConversationEnd: (session: ConversationSession) => void;
  onActivity: (event: ActivityEvent) => void;
  onSpeakerChange: (npcId: string | null) => void;
  onFloater?: (floater: FloaterData) => void;
  onEavesdropReaction?: (eavesdropperId: string, text: string) => void;
}

// Per-conversation caps on cumulative relationship change
const RELATIONSHIP_CAPS: Record<ConversationType, number> = {
  casual: 0.15,
  confrontation: 0.30,
  reconciliation: 0.20,
  confession: 0.25,
  alliance_forming: 0.20,
  gossip_session: 0.15,
};

// Turn limits by conversation type [min, max]
const TURN_LIMITS: Record<ConversationType, [number, number]> = {
  casual: [4, 8],
  confrontation: [4, 10],
  reconciliation: [5, 8],
  confession: [4, 8],
  alliance_forming: [5, 10],
  gossip_session: [5, 10],
};

/** Pre-generated conversation ready for instant playback */
interface PreparedConversation {
  npcAId: string;
  npcBId: string;
  turns: BatchTurnData[];
  audioBuffers: (ArrayBuffer | null)[];
  convType: ConversationType;
  preparedAt: number;
  llmDurationMs: number;
  ttsDurationMs: number;
  /** How many turns have finished TTS. When < turns.length, TTS is still running. */
  ttsCompletedCount: number;
  /** Whether all TTS is done */
  ttsComplete: boolean;
}

export type DirectorPhase = "idle" | "llm_generating" | "tts_prefetching" | "ready";

export interface DirectorScoredPair {
  npcAId: string;
  npcAName: string;
  npcBId: string;
  npcBName: string;
  score: number;
}

export interface PreparedConversationInfo {
  npcAName: string;
  npcBName: string;
  convType: ConversationType;
  turnCount: number;
  speeches: string[];
  speakerNames: string[];
  preparedAt: number;
  ageMs: number;
  maxAgeMs: number;
  llmDurationMs: number;
  ttsDurationMs: number;
  /** "ready" = fully prepared, "generating_tts" = actively synthesizing, "queued_for_tts" = waiting for TTS slot */
  phase: "ready" | "generating_tts" | "queued_for_tts";
  ttsElapsedMs?: number;
  /** TTS progress: how many turns have finished generating audio */
  ttsCompletedTurns?: number;
  ttsTotalTurns?: number;
}

export interface DirectorStatus {
  /** The LLM generation slot */
  generatingPair: { npcAName: string; npcBName: string; elapsedMs: number } | null;
  /** All conversations in the pipeline (TTS-in-progress + ready) */
  preparedConversations: PreparedConversationInfo[];
  /** Currently playing conversation */
  activeConversation: {
    npcAName: string;
    npcBName: string;
    turnCount: number;
    maxTurns: number;
    convType: ConversationType;
    speeches: string[];
    speakerNames: string[];
  } | null;
  /** Top scored pairs from last director tick */
  topPairs: DirectorScoredPair[];
  /** Total conversations played since start */
  conversationsPlayed: number;
  /** Total prepared conversations that expired */
  preparedExpired: number;
  /** Average LLM generation time in ms (0 if no data) */
  avgLlmMs: number;
  /** Average TTS generation time in ms (0 if no data) */
  avgTtsMs: number;
  /** Current pipeline depth (TTS-in-progress + ready) */
  pipelineDepth: number;
  /** Max pipeline depth before LLM pauses */
  maxPipelineDepth: number;
  /** Seconds remaining on rate-limit backoff (0 = no backoff) */
  backoffRemainingSecs: number;
  /** Latest Groq rate limit info (null if using Ollama or no data yet) */
  groqRateLimits: GroqRateLimits | null;
  /** The model actually used for the last/current LLM generation (may differ from config if auto-downgraded) */
  activeModel: string;
  /** Whether the model was auto-downgraded from the user's preferred model */
  modelDowngraded: boolean;
}

export class ConversationManager {
  private running = false;
  private paused = false;
  private activeSession: ConversationSession | null = null;
  private abortController: AbortController | null = null;
  private cooldowns: Map<string, number> = new Map();
  private lastConversationEnd = 0;

  private readonly MIN_TURNS = 4;
  private readonly MAX_TURNS = 18;
  private readonly COOLDOWN_MS = 30_000;
  private readonly GLOBAL_COOLDOWN_MS = 5_000;
  private readonly MIN_TURN_DURATION_MS = 1_500;

  // Frozen relationship snapshots for current conversation (prevents feedback loop)
  private frozenRelationships: Map<string, { regard: number; affection: number }> = new Map();
  // Cumulative relationship deltas for current conversation (for capping)
  private cumulativeRelDeltas: Map<string, number> = new Map();
  private activeConvType: ConversationType = "casual";

  private worldSim: WorldSimulation | null = null;
  private dayCycle: DayCycle | null = null;
  private conversationEavesdroppers: Set<string> = new Set();
  private language = "English";
  private _batchMode = false;
  private ttsService: TTSService | null = null;

  // ── Director state (pre-generates conversations in background) ──
  private directorTimer: ReturnType<typeof setInterval> | null = null;
  private preparedConversations: PreparedConversation[] = [];
  private readonly DIRECTOR_INTERVAL_MS = 5_000;
  private readonly PREPARED_MAX_AGE_MS = 600_000; // discard after 10 min

  // LLM generation slot (freed as soon as LLM finishes, before TTS)
  private llmPairKey: string | null = null;
  private llmPairIds: [string, string] | null = null;
  private llmAbort: AbortController | null = null;
  private llmStartedAt: number | null = null;

  // TTS queue — conversations waiting for the TTS slot (serialized to avoid GPU contention)
  private ttsQueue: {
    pKey: string;
    npcAId: string;
    npcBId: string;
    turns: BatchTurnData[];
    convType: ConversationType;
    llmDurationMs: number;
  }[] = [];

  // TTS prefetch tracking — only one active at a time (GPU is serial)
  private ttsInFlight = new Map<string, {
    pairIds: [string, string];
    turns: BatchTurnData[];
    convType: ConversationType;
    llmMs: number;
    startedAt: number;
    completedTurns: number;
  }>();

  // Rate limit backoff — don't retry LLM until this timestamp
  private llmBackoffUntil = 0;

  // Last conversation dialogue per pair — used for continuity when re-queuing the same pair
  private lastConversationDialogue = new Map<string, string>();

  // Model auto-downgrade tracking
  private activeGroqModel: string | null = null;
  private modelDowngraded = false;

  // ── Director telemetry ──
  private lastScoredPairs: DirectorScoredPair[] = [];
  private conversationsPlayed = 0;
  private preparedConsumed = 0;
  private preparedExpired = 0;
  private llmDurations: number[] = [];
  private ttsDurations: number[] = [];

  // (TTS-in-progress state moved into ttsInFlight map above)

  constructor(
    private store: NpcStore,
    private memory: MemoryService,
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

  setTTSService(tts: TTSService): void {
    this.ttsService = tts;
  }

  set batchMode(enabled: boolean) {
    this._batchMode = enabled;
  }

  get batchMode(): boolean {
    return this._batchMode;
  }

  /** Get a snapshot of the director's current state for the dashboard */
  getDirectorStatus(): DirectorStatus {
    const now = Date.now();

    let generatingPair: DirectorStatus["generatingPair"] = null;
    if (this.llmPairIds) {
      generatingPair = {
        npcAName: this.npcName(this.llmPairIds[0]),
        npcBName: this.npcName(this.llmPairIds[1]),
        elapsedMs: this.llmStartedAt ? now - this.llmStartedAt : 0,
      };
    }

    // Build pipeline list: TTS-queued + TTS-in-progress + fully ready conversations
    const preparedConversations: PreparedConversationInfo[] = [];

    // Actively synthesizing TTS (at most one)
    for (const [, info] of this.ttsInFlight) {
      preparedConversations.push({
        npcAName: this.npcName(info.pairIds[0]),
        npcBName: this.npcName(info.pairIds[1]),
        convType: info.convType,
        turnCount: info.turns.length,
        speeches: info.turns.map(t => t.speech),
        speakerNames: info.turns.map(t => this.npcName(t.speaker_id)),
        preparedAt: 0,
        ageMs: 0,
        maxAgeMs: this.PREPARED_MAX_AGE_MS,
        llmDurationMs: info.llmMs,
        ttsDurationMs: 0,
        phase: "generating_tts",
        ttsElapsedMs: now - info.startedAt,
        ttsCompletedTurns: info.completedTurns,
        ttsTotalTurns: info.turns.length,
      });
    }

    // Conversations queued waiting for TTS slot
    for (const q of this.ttsQueue) {
      preparedConversations.push({
        npcAName: this.npcName(q.npcAId),
        npcBName: this.npcName(q.npcBId),
        convType: q.convType,
        turnCount: q.turns.length,
        speeches: q.turns.map(t => t.speech),
        speakerNames: q.turns.map(t => this.npcName(t.speaker_id)),
        preparedAt: 0,
        ageMs: 0,
        maxAgeMs: this.PREPARED_MAX_AGE_MS,
        llmDurationMs: q.llmDurationMs,
        ttsDurationMs: 0,
        phase: "queued_for_tts",
      });
    }

    // Ready (or partially buffered) conversations
    for (const p of this.preparedConversations) {
      preparedConversations.push({
        npcAName: this.npcName(p.npcAId),
        npcBName: this.npcName(p.npcBId),
        convType: p.convType,
        turnCount: p.turns.length,
        speeches: p.turns.map(t => t.speech),
        speakerNames: p.turns.map(t => this.npcName(t.speaker_id)),
        preparedAt: p.preparedAt,
        ageMs: now - p.preparedAt,
        maxAgeMs: this.PREPARED_MAX_AGE_MS,
        llmDurationMs: p.llmDurationMs,
        ttsDurationMs: p.ttsDurationMs,
        phase: p.ttsComplete ? "ready" : "generating_tts",
        ttsCompletedTurns: p.ttsCompletedCount,
        ttsTotalTurns: p.turns.length,
      });
    }

    let activeConversation: DirectorStatus["activeConversation"] = null;
    if (this.activeSession) {
      activeConversation = {
        npcAName: this.npcName(this.activeSession.participantIds[0]),
        npcBName: this.npcName(this.activeSession.participantIds[1]),
        turnCount: this.activeSession.turnCount,
        maxTurns: this.activeSession.maxTurns,
        convType: this.activeConvType,
        speeches: this.activeSession.messages.map(m => m.text),
        speakerNames: this.activeSession.messages.map(m => m.npcName),
      };
    }

    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const backoffRemaining = Math.max(0, this.llmBackoffUntil - now);

    return {
      generatingPair,
      preparedConversations,
      activeConversation,
      topPairs: this.lastScoredPairs,
      conversationsPlayed: this.conversationsPlayed,
      preparedExpired: this.preparedExpired,
      avgLlmMs: avg(this.llmDurations),
      avgTtsMs: avg(this.ttsDurations),
      pipelineDepth: this.pipelineDepth(),
      maxPipelineDepth: this.MAX_PIPELINE_DEPTH,
      backoffRemainingSecs: Math.ceil(backoffRemaining / 1000),
      groqRateLimits: getGroqRateLimits(),
      activeModel: this.activeGroqModel ?? loadLlmConfig().groqModel,
      modelDowngraded: this.modelDowngraded,
    };
  }

  /** Play a specific turn's audio from a prepared conversation (for dashboard preview) */
  async playPreparedTurnAudio(convIndex: number, turnIndex: number): Promise<void> {
    const conv = this.preparedConversations[convIndex];
    if (!conv) return;
    const buffer = conv.audioBuffers[turnIndex];
    if (!buffer || !this.ttsService) return;
    await this.ttsService.playBuffer(buffer);
  }

  // ── Lifecycle ────────────────────────────────

  start(): void {
    this.running = true;
    this.paused = false;
    this.log("Conversation engine started");
    this.startDirector();
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
    this.stopDirector();
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
    if (this._batchMode) {
      this.runBatchConversation(npcAId, npcBId);
    } else {
      this.runConversation(npcAId, npcBId);
    }
  }

  triggerConversation(npcAId: string, npcBId: string): boolean {
    // Conversations are fully orchestrated by the director pipeline now.
    // Proximity only plays already-prepared conversations — never generates new ones.
    if (this.activeSession || !this.running || this.paused) return false;

    const now = Date.now();
    if (now - this.lastConversationEnd < this.GLOBAL_COOLDOWN_MS) return false;

    const pKey = this.pairKey(npcAId, npcBId);
    const lastTime = this.cooldowns.get(pKey) ?? 0;
    if (now - lastTime < this.COOLDOWN_MS) return false;

    // Check for a prepared conversation for this pair
    const prepared = this.consumePrepared(npcAId, npcBId);
    if (prepared) {
      this.log(`[director] Playing prepared conversation for ${this.npcName(npcAId)} + ${this.npcName(npcBId)}`);
      this.playPreparedConversation(prepared);
      return true;
    }

    return false;
  }

  private pairKey(a: string, b: string): string {
    return [a, b].sort().join(":");
  }

  /**
   * Simple word-overlap similarity check to detect repetitive speech.
   * Returns true if the new speech shares too many words with recent messages.
   */
  private isTooSimilar(newSpeech: string, session: ConversationSession): boolean {
    const normalize = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 3);

    const newWords = new Set(normalize(newSpeech));
    if (newWords.size < 3) return false; // too short to judge

    // Check against last 4 messages
    const recentMessages = session.messages.slice(-4);
    for (const msg of recentMessages) {
      const oldWords = normalize(msg.text);
      if (oldWords.length < 3) continue;

      let overlap = 0;
      for (const w of oldWords) {
        if (newWords.has(w)) overlap++;
      }
      const similarity = overlap / Math.max(newWords.size, oldWords.length);
      if (similarity > 0.6) return true;
    }
    return false;
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

    this.store.recordRelationshipSnapshot(npcAId, npcBId);
    const convType = this.classifyConversationType(npcA, npcB);
    this.activeConvType = convType;

    this.freezeRelationships(npcAId, npcBId);

    const session: ConversationSession = {
      id: `conv_${Date.now()}`,
      participantIds: [npcAId, npcBId],
      messages: [],
      turnCount: 0,
      maxTurns: this.rollMaxTurns(convType),
      status: "active",
      startedAt: Date.now(),
    };

    this.activeSession = session;
    this.conversationEavesdroppers.clear();
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

    this.finalizeConversation(session, npcAId, npcBId, "conv");
  }

  // ── Batch Conversation (full conversation in one LLM call) ──

  private async runBatchConversation(
    npcAId: string,
    npcBId: string
  ): Promise<void> {
    const npcA = this.store.get(npcAId);
    const npcB = this.store.get(npcBId);
    if (!npcA || !npcB) return;

    this.abortController = new AbortController();
    this.store.recordRelationshipSnapshot(npcAId, npcBId);
    const convType = this.classifyConversationType(npcA, npcB);
    this.activeConvType = convType;

    this.freezeRelationships(npcAId, npcBId);

    const maxTurns = this.rollMaxTurns(convType);
    const minTurns = Math.max(this.MIN_TURNS, Math.floor(maxTurns * 0.6));

    const session: ConversationSession = {
      id: `conv_${Date.now()}`,
      participantIds: [npcAId, npcBId],
      messages: [],
      turnCount: 0,
      maxTurns,
      status: "active",
      startedAt: Date.now(),
    };

    this.activeSession = session;
    this.conversationEavesdroppers.clear();
    // NOTE: We intentionally delay onConversationStart (camera zoom, UI)
    // until after LLM + TTS are ready, so the user doesn't see a long wait.
    // Freeze NPCs silently so they stay near each other during generation.
    this.worldSim?.freezeNpc(npcAId);
    this.worldSim?.freezeNpc(npcBId);
    this.log(`[batch] Generating conversation for ${npcA.name} and ${npcB.name} [${convType}, ${minTurns}-${maxTurns} turns]`);

    // ── 1. Build batch prompt ──
    const allNpcs = this.store.getAll().map(n => ({ id: n.id, name: n.name }));
    const velocity = this.store.getRelationshipVelocity(npcAId, npcBId);
    let trajectoryContext: string | undefined;
    if (velocity.values.length >= 2) {
      const descriptor = velocity.trend === "improving" ? "warming up"
        : velocity.trend === "declining" ? "deteriorating" : "stable";
      trajectoryContext = `Their relationship has been ${descriptor} over their last ${velocity.values.length} encounters.`;
    }

    const nearWp = this.worldSim?.getNearestWaypoint(npcAId);
    const locationContext = nearWp?.description;
    const timeOfDay = this.dayCycle?.getLabel();

    const memoriesA = this.memory.retrieve(npcAId, { partnerId: npcBId, excludeAbout: npcBId });
    const memoriesB = this.memory.retrieve(npcBId, { partnerId: npcAId, excludeAbout: npcAId });

    const pendingPlansA = this.store.getPromisesFor(npcAId)
      .filter(p => p.status === "active")
      .map(p => {
        const otherId = p.promiserId === npcAId ? p.promiseeId : p.promiserId;
        return { withName: this.store.get(otherId)?.name ?? otherId, text: p.text };
      });
    const pendingPlansB = this.store.getPromisesFor(npcBId)
      .filter(p => p.status === "active")
      .map(p => {
        const otherId = p.promiserId === npcBId ? p.promiseeId : p.promiserId;
        return { withName: this.store.get(otherId)?.name ?? otherId, text: p.text };
      });

    const frozenAtoB = this.frozenRelationships.get(`${npcAId}->${npcBId}`);
    const frozenBtoA = this.frozenRelationships.get(`${npcBId}->${npcAId}`);

    const messages = buildBatchConversationMessages(
      npcA, npcB, npcAId, minTurns, maxTurns,
      {
        allNpcs, trajectoryContext, locationContext,
        memoriesA, memoriesB,
        language: this.language, timeOfDay,
        pendingPlansA, pendingPlansB,
        conversationType: convType,
        frozenRegardAtoB: frozenAtoB?.regard,
        frozenAffectionAtoB: frozenAtoB?.affection,
        frozenRegardBtoA: frozenBtoA?.regard,
        frozenAffectionBtoA: frozenBtoA?.affection,
      }
    );

    // ── 2. Single LLM call (silent — no UI until ready) ──
    let turns: BatchTurnData[];
    try {
      const raw = await accumulateChat(messages, {
        signal: this.abortController!.signal,
        numPredict: 4096,
      });
      turns = parseBatchLLMResponse(raw, [npcAId, npcBId]);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        this.cleanupSession(session, npcAId, npcBId);
        return;
      }
      this.log(`[batch] LLM/parse error, falling back to per-turn mode: ${e}`);
      this.cleanupSession(session, npcAId, npcBId);
      // Fallback to per-turn mode
      this.runConversation(npcAId, npcBId);
      return;
    }

    if (turns.length === 0) {
      this.log("[batch] No turns generated, falling back to per-turn mode");
      this.cleanupSession(session, npcAId, npcBId);
      this.runConversation(npcAId, npcBId);
      return;
    }

    this.log(`[batch] Generated ${turns.length} turns, pre-fetching TTS...`);

    // ── 3. Pre-fetch TTS sequentially (GPU is serial; parallel causes timeout cascades) ──
    const audioBuffers: (ArrayBuffer | null)[] = [];
    if (this.ttsService) {
      for (const turn of turns) {
        const speaker = this.store.get(turn.speaker_id)!;
        const buf = await this.ttsService.prefetch(
          turn.speaker_id,
          turn.speech,
          speaker.emotionalState,
          this.language
        );
        audioBuffers.push(buf);
      }
    }

    // ── 4. NOW show the conversation to the user ──
    this.callbacks.onConversationStart(session);
    this.callbacks.onActivity({
      timestamp: new Date(),
      text: `${npcA.name} and ${npcB.name} are talking...`,
      activityType: "thought",
      npcId: npcAId,
    });
    this.log(`[batch] Conversation started between ${npcA.name} and ${npcB.name} (${turns.length} turns, ready)`);

    // ── 5. Playback loop ──
    await this.playbackTurns(turns, audioBuffers, session, npcAId, npcBId);

    // ── 6. Cleanup ──
    this.finalizeConversation(session, npcAId, npcBId, "batch");
  }

  /** Simulate streaming by progressively revealing speech text */
  private async simulateStreaming(npcId: string, speech: string): Promise<void> {
    // Build a partial JSON string that extractSpeechFromStream can parse
    const fullJson = JSON.stringify({ speech });
    const chunkSize = Math.max(3, Math.ceil(fullJson.length / 20));
    for (let pos = 0; pos < fullJson.length; pos += chunkSize) {
      this.callbacks.onStreamToken(npcId, fullJson.slice(0, pos + chunkSize));
      await this.sleep(50);
    }
    // Final complete token
    this.callbacks.onStreamToken(npcId, fullJson);
  }

  /** Clean up session state without running post-conversation hooks */
  private cleanupSession(session: ConversationSession, npcAId: string, npcBId: string): void {
    session.status = "aborted";
    this.activeSession = null;
    this.frozenRelationships.clear();
    this.cumulativeRelDeltas.clear();
    // Unfreeze NPCs that may have been silently frozen during generation
    this.worldSim?.unfreezeNpc(npcAId);
    this.worldSim?.unfreezeNpc(npcBId);
    this.callbacks.onSpeakerChange(null);
    this.callbacks.onConversationEnd(session);
  }

  // ── Shared conversation helpers ──

  /** Freeze relationship state for the duration of a conversation */
  private freezeRelationships(npcAId: string, npcBId: string): void {
    this.frozenRelationships.clear();
    this.cumulativeRelDeltas.clear();
    const npcA = this.store.get(npcAId)!;
    const npcB = this.store.get(npcBId)!;
    const relAtoB = npcA.relationships[npcBId];
    const relBtoA = npcB.relationships[npcAId];
    this.frozenRelationships.set(`${npcAId}->${npcBId}`, {
      regard: relAtoB?.regard ?? 0,
      affection: relAtoB?.affection ?? 0,
    });
    this.frozenRelationships.set(`${npcBId}->${npcAId}`, {
      regard: relBtoA?.regard ?? 0,
      affection: relBtoA?.affection ?? 0,
    });
    this.cumulativeRelDeltas.set(`${npcAId}->${npcBId}`, 0);
    this.cumulativeRelDeltas.set(`${npcBId}->${npcAId}`, 0);
  }

  /** Convert batch turn data to an LLMResponse */
  private batchTurnToResponse(turn: BatchTurnData): LLMResponse {
    return {
      speech: turn.speech,
      emotion_delta: turn.emotion_delta,
      relationship_delta: turn.relationship_delta,
      affection_delta: turn.affection_delta,
      intent: turn.intent,
      conversation_end: false,
      mentioned_npcs: turn.mentioned_npcs,
      secret_revealed: turn.secret_revealed,
      promise: turn.promise,
      action: turn.action,
    };
  }

  /** Play back pre-generated turns with audio, applying side effects during playback */
  private async playbackTurns(
    turns: BatchTurnData[],
    audioBuffers: (ArrayBuffer | null)[],
    session: ConversationSession,
    npcAId: string,
    npcBId: string,
    awaitAudio?: (index: number) => Promise<void>,
  ): Promise<void> {
    for (let i = 0; i < turns.length; i++) {
      if (!this.running || session.status !== "active") break;

      while (this.paused && this.running) {
        await this.sleep(200);
      }
      if (!this.running) break;

      const turn = turns[i];
      const speakerId = turn.speaker_id;
      const listenerId = speakerId === npcAId ? npcBId : npcAId;
      const speaker = this.store.get(speakerId)!;
      const listener = this.store.get(listenerId)!;

      this.callbacks.onSpeakerChange(speakerId);
      await this.simulateStreaming(speakerId, turn.speech);

      const response = this.batchTurnToResponse(turn);

      this.store.batch(() => {
        this.applyTurnEffects(speaker, listener, response);
      });

      if (response.action?.action === "storm_off") {
        response.conversation_end = true;
      }

      const msg: ConversationMessage = {
        npcId: speakerId,
        npcName: speaker.name,
        text: response.speech,
        intent: response.intent,
        rawResponse: response,
      };

      session.messages.push(msg);
      session.turnCount++;

      this.callbacks.onTurnComplete(msg);
      this.callbacks.onStreamToken(speakerId, "");

      this.logEmotionShifts(speaker, listener, response);
      this.logRelationshipShift(speaker, listener, response);

      if (this.worldSim && Math.random() < 0.5) {
        this.checkEavesdroppers(speaker, listener, response);
      }

      if (awaitAudio) {
        await awaitAudio(i);
      }

      if (audioBuffers[i]) {
        await this.ttsService!.playBuffer(audioBuffers[i]!);
      } else {
        await this.sleep(Math.max(1500, turn.speech.length * 40));
      }
      this.callbacks.onTurnAudioEnd?.(speakerId);

      if (response.conversation_end) {
        this.log(`${speaker.name} ended the conversation`);
        break;
      }
    }
  }

  /** Post-conversation cleanup: record snapshots, decay emotions, store memories */
  private finalizeConversation(
    session: ConversationSession,
    npcAId: string,
    npcBId: string,
    logPrefix: string,
  ): void {
    const npcA = this.store.get(npcAId);
    const npcB = this.store.get(npcBId);

    session.status = "completed";
    this.store.recordRelationshipSnapshot(npcAId, npcBId);
    this.activeSession = null;
    this.frozenRelationships.clear();
    this.cumulativeRelDeltas.clear();
    this.lastConversationEnd = Date.now();
    this.cooldowns.set(this.pairKey(npcAId, npcBId), Date.now());
    this.callbacks.onSpeakerChange(null);
    this.callbacks.onConversationEnd(session);
    this.conversationsPlayed++;
    this.log(`[${logPrefix}] Conversation ended between ${npcA?.name} and ${npcB?.name} (${session.turnCount} turns)`);

    this.store.batch(() => {
      this.store.decayEmotions(npcAId);
      this.store.decayEmotions(npcBId);
      this.memory.decayAllRecency();
    });

    this.storeConversationSummaryMemory(npcAId, npcBId, session);
    this.logConversationSummary(npcAId, npcBId);
    this.applyEmotionalContagion(npcAId, npcBId, session);
    this.triggerPostConversationBehavior(npcAId, npcBId, session);
    this.runPostConversationReflection(npcAId, npcBId, session).catch(() => {});
  }

  // ── Director: proactive conversation scheduling ──

  private startDirector(): void {
    if (!this._batchMode) return;
    this.stopDirector();
    this.directorTimer = setInterval(() => this.directorTick(), this.DIRECTOR_INTERVAL_MS);
    this.log("[director] Started");
  }

  private stopDirector(): void {
    if (this.directorTimer) {
      clearInterval(this.directorTimer);
      this.directorTimer = null;
    }
    if (this.llmAbort) {
      this.llmAbort.abort();
      this.llmAbort = null;
    }
    this.preparedConversations = [];
    this.llmPairKey = null;
    this.llmPairIds = null;
    this.llmStartedAt = null;
    this.ttsQueue = [];
    this.ttsInFlight.clear();
  }

  private directorTick(): void {
    if (!this.running || this.paused) return;

    // Expire stale prepared conversations
    const now = Date.now();
    const before = this.preparedConversations.length;
    this.preparedConversations = this.preparedConversations.filter(p => {
      // Don't expire conversations still being TTS'd — processNextTts holds a reference
      if (!p.ttsComplete) return true;
      if (now - p.preparedAt > this.PREPARED_MAX_AGE_MS) {
        this.log(`[director] Discarding stale conversation for ${this.npcName(p.npcAId)} + ${this.npcName(p.npcBId)}`);
        this.preparedExpired++;
        return false;
      }
      return true;
    });

    // ── Play prepared conversations ──
    // Director plays the oldest eligible conversation, but only when the NPCs are close enough.
    // Seek overrides keep them walking toward each other until proximity is met.
    if (!this.activeSession && this.preparedConversations.length > 0) {
      if (now - this.lastConversationEnd < this.GLOBAL_COOLDOWN_MS) return;
      for (let i = 0; i < this.preparedConversations.length; i++) {
        const p = this.preparedConversations[i];
        const pKey = this.pairKey(p.npcAId, p.npcBId);
        const lastTime = this.cooldowns.get(pKey) ?? 0;
        // Skip pair cooldown if this conversation was pre-generated after the last one ended
        // (it already accounts for the previous dialogue, so it's safe to play immediately)
        const preGeneratedAfterCooldown = p.preparedAt > lastTime;
        if (!preGeneratedAfterCooldown && now - lastTime < this.COOLDOWN_MS) continue;

        // Wait for NPCs to be near each other before playing
        if (this.worldSim) {
          const posA = this.worldSim.getNpcPosition(p.npcAId);
          const posB = this.worldSim.getNpcPosition(p.npcBId);
          if (posA && posB) {
            const dist = Math.abs(posA.x - posB.x) + Math.abs(posA.y - posB.y);
            if (dist > 5) continue; // still walking toward each other
          }
        }

        this.preparedConversations.splice(i, 1);
        this.preparedConsumed++;
        this.log(`[director] Playing conversation for ${this.npcName(p.npcAId)} + ${this.npcName(p.npcBId)}`);
        this.playPreparedConversation(p);
        return;
      }
    }

    // Only start a new LLM generation if the LLM slot is free.
    // TTS runs independently and doesn't block this.
    if (this.llmPairKey) return;
    if (Date.now() < this.llmBackoffUntil) return;
    if (this.pipelineDepth() >= this.MAX_PIPELINE_DEPTH) return;

    // Pick the most interesting pair
    const pair = this.pickNextPair();
    if (!pair) return;

    const [npcAId, npcBId] = pair;
    this.llmPairKey = this.pairKey(npcAId, npcBId);
    this.llmPairIds = [npcAId, npcBId];
    this.llmStartedAt = Date.now();

    this.log(`[director] Pre-generating conversation for ${this.npcName(npcAId)} + ${this.npcName(npcBId)}`);

    // Set seek overrides so they walk toward each other (match max age so they keep seeking)
    this.store.setBehavioralOverride(npcAId, {
      mode: "seek",
      targetNpcId: npcBId,
      expiresAt: Date.now() + this.PREPARED_MAX_AGE_MS,
      reason: "Director: approaching for conversation",
    });
    this.store.setBehavioralOverride(npcBId, {
      mode: "seek",
      targetNpcId: npcAId,
      expiresAt: Date.now() + this.PREPARED_MAX_AGE_MS,
      reason: "Director: approaching for conversation",
    });

    // Run the pipeline: LLM → free slot → TTS (independent)
    this.runPipeline(npcAId, npcBId).catch(() => {});
  }

  /** Pipeline: generate LLM, free LLM slot, then TTS independently */
  private async runPipeline(npcAId: string, npcBId: string): Promise<void> {
    const npcA = this.store.get(npcAId);
    const npcB = this.store.get(npcBId);
    if (!npcA || !npcB) {
      this.clearLlmSlot();
      return;
    }

    this.llmAbort = new AbortController();
    const convType = this.classifyConversationType(npcA, npcB);
    const maxTurns = this.rollMaxTurns(convType);
    const minTurns = Math.max(this.MIN_TURNS, Math.floor(maxTurns * 0.6));

    // Build context
    const allNpcs = this.store.getAll().map(n => ({ id: n.id, name: n.name }));
    const velocity = this.store.getRelationshipVelocity(npcAId, npcBId);
    let trajectoryContext: string | undefined;
    if (velocity.values.length >= 2) {
      const descriptor = velocity.trend === "improving" ? "warming up"
        : velocity.trend === "declining" ? "deteriorating" : "stable";
      trajectoryContext = `Their relationship has been ${descriptor} over their last ${velocity.values.length} encounters.`;
    }

    const nearWp = this.worldSim?.getNearestWaypoint(npcAId);
    const locationContext = nearWp?.description;
    const timeOfDay = this.dayCycle?.getLabel();

    const memoriesA = this.memory.retrieve(npcAId, { partnerId: npcBId, excludeAbout: npcBId });
    const memoriesB = this.memory.retrieve(npcBId, { partnerId: npcAId, excludeAbout: npcAId });

    const pendingPlansA = this.store.getPromisesFor(npcAId)
      .filter(p => p.status === "active")
      .map(p => {
        const otherId = p.promiserId === npcAId ? p.promiseeId : p.promiserId;
        return { withName: this.store.get(otherId)?.name ?? otherId, text: p.text };
      });
    const pendingPlansB = this.store.getPromisesFor(npcBId)
      .filter(p => p.status === "active")
      .map(p => {
        const otherId = p.promiserId === npcBId ? p.promiseeId : p.promiserId;
        return { withName: this.store.get(otherId)?.name ?? otherId, text: p.text };
      });

    const relAtoB = npcA.relationships[npcBId];
    const relBtoA = npcB.relationships[npcAId];

    // Check for a previous conversation between this pair (for continuity)
    const prevPKey = this.pairKey(npcAId, npcBId);
    const previousConversation = this.lastConversationDialogue.get(prevPKey);

    const messages = buildBatchConversationMessages(
      npcA, npcB, npcAId, minTurns, maxTurns,
      {
        allNpcs, trajectoryContext, locationContext,
        memoriesA, memoriesB,
        language: this.language, timeOfDay,
        pendingPlansA, pendingPlansB,
        conversationType: convType,
        frozenRegardAtoB: relAtoB?.regard,
        frozenAffectionAtoB: relAtoB?.affection,
        frozenRegardBtoA: relBtoA?.regard,
        frozenAffectionBtoA: relBtoA?.affection,
        previousConversation,
      }
    );

    // ── Phase 1: LLM generation ──
    const llmStart = Date.now();
    const modelOverride = loadLlmConfig().provider === "groq" ? this.pickGroqModel() : undefined;
    let turns: BatchTurnData[];
    try {
      const raw = await accumulateChat(messages, {
        signal: this.llmAbort.signal,
        numPredict: 4096,
        modelOverride,
      });
      turns = parseBatchLLMResponse(raw, [npcAId, npcBId]);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        this.clearLlmSlot();
        return;
      }
      const errMsg = String(e);
      // Detect rate limiting (HTTP 429) and back off instead of retrying immediately
      const retryMatch = errMsg.match(/try again in (\d+)m([\d.]+)s/);
      if (errMsg.includes("429") || errMsg.includes("rate_limit")) {
        const backoffSecs = retryMatch
          ? parseInt(retryMatch[1]) * 60 + parseFloat(retryMatch[2])
          : 60;
        this.llmBackoffUntil = Date.now() + backoffSecs * 1000;
        // Force-downgrade model so we don't retry with the same rate-limited model
        const config = loadLlmConfig();
        if (config.provider === "groq" && config.groqModel !== this.GROQ_FALLBACK_MODEL) {
          this.modelDowngraded = true;
          this.activeGroqModel = this.GROQ_FALLBACK_MODEL;
          this.log(`[director] Rate limited on ${config.groqModel} — switching to ${this.GROQ_FALLBACK_MODEL}, backing off ${Math.ceil(backoffSecs)}s`);
        } else {
          this.log(`[director] Rate limited — backing off for ${Math.ceil(backoffSecs)}s`);
        }
      } else {
        // Any other error (400 bad model, 401 auth, parse error, etc.)
        // Apply a short backoff to prevent runaway retry loops
        this.llmBackoffUntil = Date.now() + 15_000;
        this.log(`[director] LLM/parse error (pausing 15s): ${e}`);
      }
      this.clearLlmSlot();
      // Don't kick — let the backoff expire and directorTick will resume
      return;
    }

    if (turns.length === 0) {
      this.clearLlmSlot();
      this.kickNextLlm();
      return;
    }

    const llmDurationMs = Date.now() - llmStart;
    this.llmDurations.push(llmDurationMs);
    this.log(`[director] LLM done for ${this.npcName(npcAId)} + ${this.npcName(npcBId)} (${turns.length} turns, ${Math.round(llmDurationMs / 1000)}s)`);

    // ── Free the LLM slot — director can now start generating the next conversation ──
    this.llmAbort = null;
    this.clearLlmSlot();
    this.kickNextLlm();

    // ── Stash dialogue for continuity if this pair gets re-queued ──
    const pKey = this.pairKey(npcAId, npcBId);
    const dialogueSummary = turns.map(t => {
      const name = this.npcName(t.speaker_id);
      return `${name}: ${t.speech}`;
    }).join("\n");
    this.lastConversationDialogue.set(pKey, dialogueSummary);
    // Cap stored dialogues to prevent unbounded growth
    if (this.lastConversationDialogue.size > 50) {
      const oldest = this.lastConversationDialogue.keys().next().value!;
      this.lastConversationDialogue.delete(oldest);
    }

    // ── Phase 2: Queue for TTS (serialized — GPU processes one at a time) ──
    this.ttsQueue.push({ pKey, npcAId, npcBId, turns, convType, llmDurationMs });
    this.processNextTts();
  }

  private clearLlmSlot(): void {
    this.llmPairKey = null;
    this.llmPairIds = null;
    this.llmStartedAt = null;
  }

  /** Process the next conversation in the TTS queue (one at a time). */
  private async processNextTts(): Promise<void> {
    // Only one TTS job active at a time
    if (this.ttsInFlight.size > 0 || this.ttsQueue.length === 0) return;

    const item = this.ttsQueue.shift()!;
    const { pKey, npcAId, npcBId, turns, convType, llmDurationMs } = item;

    const ttsStart = Date.now();
    const inFlightEntry = {
      pairIds: [npcAId, npcBId] as [string, string],
      turns,
      convType,
      llmMs: llmDurationMs,
      startedAt: ttsStart,
      completedTurns: 0,
    };
    this.ttsInFlight.set(pKey, inFlightEntry);

    // Create a shared PreparedConversation that playback can start consuming
    // before all TTS is done. audioBuffers is filled progressively.
    const audioBuffers: (ArrayBuffer | null)[] = new Array(turns.length).fill(null);
    const prepared: PreparedConversation = {
      npcAId, npcBId, turns, audioBuffers,
      convType, preparedAt: Date.now(),
      llmDurationMs, ttsDurationMs: 0,
      ttsCompletedCount: 0,
      ttsComplete: false,
    };

    let pushedToPrepared = false;
    const bufferThreshold = Math.min(this.TTS_BUFFER_THRESHOLD, turns.length);

    try {
      if (this.ttsService) {
        for (let i = 0; i < turns.length; i++) {
          if (!this.running) break;
          const turn = turns[i];
          const speaker = this.store.get(turn.speaker_id)!;
          const buf = await this.ttsService.prefetch(
            turn.speaker_id,
            turn.speech,
            speaker.emotionalState,
            this.language
          );
          audioBuffers[i] = buf;
          inFlightEntry.completedTurns++;
          prepared.ttsCompletedCount = i + 1;

          // After enough turns are buffered, make the conversation available for playback
          if (!pushedToPrepared && prepared.ttsCompletedCount >= bufferThreshold) {
            this.preparedConversations.push(prepared);
            pushedToPrepared = true;
            this.log(`[director] Conversation playable for ${this.npcName(npcAId)} + ${this.npcName(npcBId)} (${bufferThreshold}/${turns.length} turns buffered)`);
          }
        }
      }

      const ttsDurationMs = Date.now() - ttsStart;
      this.ttsDurations.push(ttsDurationMs);
      prepared.ttsDurationMs = ttsDurationMs;
      prepared.ttsComplete = true;

      if (!this.running) return;

      // If we never hit the threshold (e.g. very short conversation), push now
      if (!pushedToPrepared) {
        this.preparedConversations.push(prepared);
        this.log(`[director] Conversation ready for ${this.npcName(npcAId)} + ${this.npcName(npcBId)} (${turns.length} turns)`);
      } else {
        this.log(`[director] TTS complete for ${this.npcName(npcAId)} + ${this.npcName(npcBId)} (${turns.length} turns, ${Math.round(ttsDurationMs / 1000)}s)`);
      }
    } finally {
      this.ttsInFlight.delete(pKey);
    }

    // Process next queued conversation
    this.processNextTts();
  }

  /** Number of conversations ahead of playback (TTS queue + TTS-in-progress + ready). */
  private pipelineDepth(): number {
    return this.preparedConversations.length + this.ttsInFlight.size + this.ttsQueue.length;
  }

  private readonly MAX_PIPELINE_DEPTH = 3;
  /** Minimum TTS turns buffered before a conversation can start playing */
  private readonly TTS_BUFFER_THRESHOLD = 2;

  /** Pick the best Groq model based on remaining rate limit quota.
   *  Falls back to the fast 8B model when tokens are running low. */
  private readonly GROQ_FALLBACK_MODEL = "llama-3.1-8b-instant";
  private readonly GROQ_DOWNGRADE_THRESHOLD = 0.2; // downgrade when <20% tokens remain

  private pickGroqModel(): string {
    const config = loadLlmConfig();
    if (config.provider !== "groq") return config.ollamaModel;

    const preferred = config.groqModel;
    const limits = getGroqRateLimits();

    if (limits && limits.limitTokens > 0) {
      const ratio = limits.remainingTokens / limits.limitTokens;
      // Downgrade when tokens are low
      if (ratio < this.GROQ_DOWNGRADE_THRESHOLD && preferred !== this.GROQ_FALLBACK_MODEL) {
        if (!this.modelDowngraded) {
          this.log(`[director] Auto-downgrading to ${this.GROQ_FALLBACK_MODEL} (${Math.round(ratio * 100)}% tokens remaining)`);
        }
        this.modelDowngraded = true;
        this.activeGroqModel = this.GROQ_FALLBACK_MODEL;
        return this.GROQ_FALLBACK_MODEL;
      }
      // Only un-downgrade when quota has clearly recovered (>50%)
      if (this.modelDowngraded && ratio > 0.5) {
        this.log(`[director] Quota recovered (${Math.round(ratio * 100)}%) — upgrading back to ${preferred}`);
        this.modelDowngraded = false;
      }
    }

    // If force-downgraded by 429 handler, keep using fallback even if headers are stale
    // But if the user manually switched to the fallback model, clear the flag
    if (this.modelDowngraded) {
      if (preferred === this.GROQ_FALLBACK_MODEL) {
        this.modelDowngraded = false;
      } else {
        this.activeGroqModel = this.GROQ_FALLBACK_MODEL;
        return this.GROQ_FALLBACK_MODEL;
      }
    }

    this.activeGroqModel = preferred;
    return preferred;
  }

  /** Immediately start the next LLM generation without waiting for the director tick.
   *  Critical for fast providers (Groq ~2-3s) where the 5s tick interval would leave the pipeline idle. */
  private kickNextLlm(): void {
    if (!this.running || this.paused || this.llmPairKey) return;
    if (Date.now() < this.llmBackoffUntil) return;
    if (this.pipelineDepth() >= this.MAX_PIPELINE_DEPTH) return;
    const pair = this.pickNextPair();
    if (!pair) return;
    const [npcAId, npcBId] = pair;
    this.llmPairKey = this.pairKey(npcAId, npcBId);
    this.llmPairIds = [npcAId, npcBId];
    this.llmStartedAt = Date.now();
    this.log(`[director] Pre-generating conversation for ${this.npcName(npcAId)} + ${this.npcName(npcBId)}`);
    this.runPipeline(npcAId, npcBId);
  }

  /** Pick the most interesting NPC pair for the next conversation */
  private pickNextPair(): [string, string] | null {
    const allNpcs = this.store.getAll();
    if (allNpcs.length < 2) return null;

    // Skip NPCs currently in a conversation
    const busyIds = new Set(this.activeSession?.participantIds ?? []);
    // Skip pairs that already have a prepared conversation, are being TTS'd, or are queued for TTS
    const preparedPairKeys = new Set([
      ...this.preparedConversations.map(p => this.pairKey(p.npcAId, p.npcBId)),
      ...this.ttsInFlight.keys(),
      ...this.ttsQueue.map(q => q.pKey),
    ]);

    const now = Date.now();
    const scored: DirectorScoredPair[] = [];

    for (let i = 0; i < allNpcs.length; i++) {
      for (let j = i + 1; j < allNpcs.length; j++) {
        const a = allNpcs[i];
        const b = allNpcs[j];
        if (busyIds.has(a.id) || busyIds.has(b.id)) continue;
        const pKey = this.pairKey(a.id, b.id);

        // Skip if already prepared or being TTS'd
        if (preparedPairKeys.has(pKey)) continue;

        // Skip if on cooldown
        const lastTime = this.cooldowns.get(pKey) ?? 0;
        if (now - lastTime < this.COOLDOWN_MS) continue;

        // Skip if either is frozen or has an active override
        if (a.behavioralOverride || b.behavioralOverride) continue;

        let score = 0;

        // Relationship velocity — fast-changing relationships are interesting
        const velocity = this.store.getRelationshipVelocity(a.id, b.id);
        if (velocity.trend === "improving" || velocity.trend === "declining") {
          score += 3;
        }

        // Pending promises between them
        const promises = this.store.getPromisesFor(a.id)
          .filter(p => p.status === "active" &&
            (p.promiseeId === b.id || p.promiserId === b.id));
        score += promises.length * 2;

        // Time since last conversation — longer gap = more interesting
        const timeSince = now - lastTime;
        score += Math.min(5, timeSince / 60_000); // up to 5 points for 5+ min gap

        // Emotional intensity — emotional NPCs make for better conversations
        const emoA = a.emotionalState;
        const emoB = b.emotionalState;
        const intensityA = Math.max(emoA.anger, emoA.joy, emoA.fear, emoA.sadness);
        const intensityB = Math.max(emoB.anger, emoB.joy, emoB.fear, emoB.sadness);
        score += (intensityA + intensityB) * 2;

        // Relationship extremes are interesting
        const regard = a.relationships[b.id]?.regard ?? 0;
        score += Math.abs(regard) * 2;

        // Small random factor to prevent always picking the same pair
        score += Math.random() * 1.5;

        scored.push({
          npcAId: a.id, npcAName: a.name,
          npcBId: b.id, npcBName: b.name,
          score: Math.round(score * 100) / 100,
        });
      }
    }

    // Sort descending and save top 5 for dashboard
    scored.sort((a, b) => b.score - a.score);
    this.lastScoredPairs = scored.slice(0, 5);

    if (scored.length > 0) return [scored[0].npcAId, scored[0].npcBId];

    // Fallback: if no pairs passed filters, allow re-queuing the only available pair
    // (e.g. 2-NPC sim where the pair is on cooldown or already in pipeline).
    // Skip cooldown and dedup checks, but still skip busy/overridden NPCs.
    const available = allNpcs.filter(n => !busyIds.has(n.id) && !n.behavioralOverride);
    if (available.length >= 2) {
      // Don't re-queue if there's already one in the pipeline for this pair
      const pKey = this.pairKey(available[0].id, available[1].id);
      if (!preparedPairKeys.has(pKey)) {
        return [available[0].id, available[1].id];
      }
    }

    return null;
  }

  /** Check if there's a prepared conversation for this pair and consume it */
  private consumePrepared(npcAId: string, npcBId: string): PreparedConversation | null {
    const idx = this.preparedConversations.findIndex(p => {
      const matchesPair =
        (p.npcAId === npcAId && p.npcBId === npcBId) ||
        (p.npcAId === npcBId && p.npcBId === npcAId);
      return matchesPair;
    });

    if (idx === -1) return null;

    const p = this.preparedConversations[idx];
    if (Date.now() - p.preparedAt > this.PREPARED_MAX_AGE_MS) {
      this.preparedConversations.splice(idx, 1);
      this.preparedExpired++;
      return null;
    }

    this.preparedConversations.splice(idx, 1);
    this.preparedConsumed++;
    return p;
  }

  /** Play a pre-generated conversation with instant start */
  private async playPreparedConversation(prepared: PreparedConversation): Promise<void> {
    const { npcAId, npcBId, turns, audioBuffers, convType } = prepared;
    const npcA = this.store.get(npcAId);
    const npcB = this.store.get(npcBId);
    if (!npcA || !npcB) return;

    this.abortController = new AbortController();
    this.store.recordRelationshipSnapshot(npcAId, npcBId);
    this.activeConvType = convType;

    // Clear seek overrides from director
    this.store.setBehavioralOverride(npcAId, null);
    this.store.setBehavioralOverride(npcBId, null);

    this.freezeRelationships(npcAId, npcBId);

    const session: ConversationSession = {
      id: `conv_${Date.now()}`,
      participantIds: [npcAId, npcBId],
      messages: [],
      turnCount: 0,
      maxTurns: turns.length,
      status: "active",
      startedAt: Date.now(),
    };

    this.activeSession = session;
    this.conversationEavesdroppers.clear();
    this.callbacks.onConversationStart(session);
    this.log(`[director] Playing ${turns.length}-turn conversation between ${npcA.name} and ${npcB.name} [${convType}]`);

    // Playback with streaming TTS await
    await this.playbackTurns(turns, audioBuffers, session, npcAId, npcBId, async (i) => {
      if (!audioBuffers[i] && !prepared.ttsComplete) {
        while (!audioBuffers[i] && !prepared.ttsComplete && this.running) {
          await this.sleep(50);
        }
      }
    });

    this.finalizeConversation(session, npcAId, npcBId, "director");
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

    const retrievedMemories = this.memory.retrieve(speaker.id, {
      partnerId: listener.id,
      excludeAbout: listener.id,
    });

    const timeOfDay = this.dayCycle?.getLabel();
    const pendingPlans = this.store.getPromisesFor(speaker.id)
      .filter(p => p.status === "active")
      .map(p => {
        const otherId = p.promiserId === speaker.id ? p.promiseeId : p.promiserId;
        const otherNpc = this.store.get(otherId);
        return { withName: otherNpc?.name ?? otherId, text: p.text };
      });

    // Use frozen relationship snapshot so the prompt doesn't amplify within a conversation
    const frozenKey = `${speaker.id}->${listener.id}`;
    const frozen = this.frozenRelationships.get(frozenKey);

    const messages = buildConversationMessages(
      currentSpeaker,
      currentListener,
      session,
      {
        allNpcs,
        trajectoryContext,
        locationContext,
        retrievedMemories,
        language: this.language,
        timeOfDay,
        pendingPlans,
        conversationType: this.activeConvType,
        frozenRegard: frozen?.regard,
        frozenAffection: frozen?.affection,
      }
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

    // Check for repetition — if speech is too similar to a recent message, retry once
    if (session.messages.length >= 2 && this.isTooSimilar(response.speech, session)) {
      this.log(`${speaker.name} repeated themselves, requesting redirect...`);
      messages.push({ role: "assistant", content: raw });
      messages.push({
        role: "user",
        content: `You just said something too similar to what was already said in this conversation. Say something COMPLETELY DIFFERENT — a new topic, a question, a reaction to your surroundings, or bring up another person. Respond with ONLY a JSON object.`,
      });
      try {
        const redirectRaw = await accumulateChat(
          messages,
          undefined,
          this.abortController!.signal
        );
        response = parseLLMResponse(redirectRaw);
      } catch {
        // Use the original response if redirect fails
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

    const systemMsg = messages.find(m => m.role === "system");
    const msg: ConversationMessage = {
      npcId: speaker.id,
      npcName: speaker.name,
      text: response.speech,
      intent: response.intent,
      rawResponse: response,
      systemPrompt: systemMsg?.content,
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

    // Cap cumulative relationship change per conversation
    const cap = RELATIONSHIP_CAPS[this.activeConvType];
    const speakerKey = `${speaker.id}->${listener.id}`;
    const listenerKey = `${listener.id}->${speaker.id}`;

    let speakerDelta = response.relationship_delta;
    let listenerDelta = response.relationship_delta * 0.5;
    let speakerAffDelta = response.affection_delta;
    let listenerAffDelta = response.affection_delta * 0.3;

    // Clamp speaker's delta if cumulative would exceed cap
    const speakerCumulative = this.cumulativeRelDeltas.get(speakerKey) ?? 0;
    if (Math.abs(speakerCumulative + speakerDelta) > cap) {
      const remaining = cap - Math.abs(speakerCumulative);
      if (remaining <= 0) {
        speakerDelta = 0;
        speakerAffDelta = 0;
      } else {
        speakerDelta = Math.sign(speakerDelta) * Math.min(Math.abs(speakerDelta), remaining);
      }
    }
    this.cumulativeRelDeltas.set(speakerKey, speakerCumulative + speakerDelta);

    // Clamp listener's mirror delta
    const listenerCumulative = this.cumulativeRelDeltas.get(listenerKey) ?? 0;
    if (Math.abs(listenerCumulative + listenerDelta) > cap) {
      const remaining = cap - Math.abs(listenerCumulative);
      if (remaining <= 0) {
        listenerDelta = 0;
        listenerAffDelta = 0;
      } else {
        listenerDelta = Math.sign(listenerDelta) * Math.min(Math.abs(listenerDelta), remaining);
      }
    }
    this.cumulativeRelDeltas.set(listenerKey, listenerCumulative + listenerDelta);

    this.store.applyRelationshipDelta(
      speaker.id,
      listener.id,
      speakerDelta,
      speakerAffDelta
    );

    // Listener gets dampened mirror of relationship delta
    this.store.applyRelationshipDelta(
      listener.id,
      speaker.id,
      listenerDelta,
      listenerAffDelta
    );

    // Per-turn memories are only stored for significant events (secrets, promises,
    // gossip, actions). Routine dialogue gets a single summary memory post-conversation
    // via storeConversationSummaryMemory() to avoid flooding short-term memory.

    // Secret reveals
    if (response.secret_revealed) {
      const matchedSecret = speaker.secrets.find((s) =>
        s.toLowerCase().includes(
          response.secret_revealed!.toLowerCase().slice(0, 30)
        )
      );

      if (matchedSecret) {
        this.store.addKnownSecret(listener.id, speaker.id, matchedSecret);

        this.memory.add(
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

        this.memory.add(
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

      this.memory.add(
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

      this.memory.add(
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

        this.memory.add(
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
    let giftDesc = action.detail ?? "a small token";

    // Try to consume an actual inventory item
    if (speaker.inventory.length > 0) {
      const item = speaker.inventory[0];
      giftDesc = `${item.emoji} ${item.label}`;
      this.store.removeItem(speaker.id, item.id);
    }

    this.store.applyRelationshipDelta(speaker.id, listener.id, 0.15);
    this.store.applyRelationshipDelta(listener.id, speaker.id, 0.15);
    this.store.applyEmotionDelta(speaker.id, { anger: 0, trust: 0.05, fear: 0, joy: 0.1, sadness: 0, curiosity: 0, disgust: 0, guilt: 0 });
    this.store.applyEmotionDelta(listener.id, { anger: 0, trust: 0.05, fear: 0, joy: 0.1, sadness: 0, curiosity: 0, disgust: 0, guilt: 0 });

    this.memory.add(speaker.id, {
      text: `I gave ${listener.name} a gift: ${giftDesc}`,
      importance: 0.7, recency: 1, emotionalWeight: 0.6,
      involvedNpcIds: [listener.id], aboutNpcIds: [],
      type: "action_performed", sentiment: 0.5, timestamp: Date.now(),
    }, "shortTermMemory");

    this.memory.add(listener.id, {
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
    this.store.applyEmotionDelta(listener.id, { anger: 0.1, trust: -0.1, fear: 0, joy: -0.05, sadness: 0.05, curiosity: 0, disgust: 0.03, guilt: 0 });
    this.store.applyEmotionDelta(speaker.id, { anger: 0, trust: 0, fear: 0, joy: 0.05, sadness: 0, curiosity: 0, disgust: 0, guilt: 0 });

    this.memory.add(speaker.id, {
      text: `I publicly mocked ${listener.name}: ${mockDetail}`,
      importance: 0.6, recency: 1, emotionalWeight: 0.5,
      involvedNpcIds: [listener.id], aboutNpcIds: [listener.id],
      type: "action_performed", sentiment: -0.4, timestamp: Date.now(),
    }, "shortTermMemory");

    this.memory.add(listener.id, {
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
    this.store.applyEmotionDelta(speaker.id, { anger: 0.05, trust: -0.05, fear: 0, joy: -0.05, sadness: 0, curiosity: 0, disgust: 0.03, guilt: 0 });
    this.store.applyEmotionDelta(listener.id, { anger: 0.05, trust: -0.05, fear: 0, joy: -0.05, sadness: 0.03, curiosity: 0, disgust: 0, guilt: 0 });

    this.store.setBehavioralOverride(speaker.id, {
      mode: "avoid",
      targetNpcId: listener.id,
      expiresAt: Date.now() + 120_000,
      reason: `Stormed off from conversation with ${listener.name}`,
    });

    this.memory.add(speaker.id, {
      text: `I stormed off from my conversation with ${listener.name}`,
      importance: 0.7, recency: 1, emotionalWeight: 0.6,
      involvedNpcIds: [listener.id], aboutNpcIds: [],
      type: "action_performed", sentiment: -0.3, timestamp: Date.now(),
    }, "shortTermMemory");

    this.memory.add(listener.id, {
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
    this.store.applyEmotionDelta(speaker.id, { anger: -0.05, trust: 0.1, fear: -0.05, joy: 0.1, sadness: -0.05, curiosity: 0, disgust: 0, guilt: 0 });
    this.store.applyEmotionDelta(listener.id, { anger: -0.05, trust: 0.1, fear: -0.05, joy: 0.1, sadness: -0.05, curiosity: 0, disgust: 0, guilt: 0 });

    this.memory.add(speaker.id, {
      text: `I embraced ${listener.name}: ${desc}`,
      importance: 0.7, recency: 1, emotionalWeight: 0.7,
      involvedNpcIds: [listener.id], aboutNpcIds: [],
      type: "action_performed", sentiment: 0.6, timestamp: Date.now(),
    }, "shortTermMemory");

    this.memory.add(listener.id, {
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
    this.store.applyEmotionDelta(listener.id, { anger: 0.05, trust: -0.1, fear: 0.15, joy: -0.05, sadness: 0, curiosity: 0, disgust: 0, guilt: 0 });

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

    this.memory.add(speaker.id, {
      text: `I threatened ${listener.name}: ${threat}`,
      importance: 0.8, recency: 1, emotionalWeight: 0.7,
      involvedNpcIds: [listener.id], aboutNpcIds: [listener.id],
      type: "action_performed", sentiment: -0.5, timestamp: Date.now(),
    }, "shortTermMemory");

    // Threats go to long-term memory for the recipient
    this.memory.add(listener.id, {
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

    this.memory.add(speaker.id, {
      text: `I conspired with ${listener.name} against ${targetName}: ${plan}`,
      importance: 0.85, recency: 1, emotionalWeight: 0.7,
      involvedNpcIds: [listener.id], aboutNpcIds: [targetId],
      type: "alliance", sentiment: -0.5, timestamp: Date.now(),
    }, "longTermMemory");

    this.memory.add(listener.id, {
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

    this.memory.add(listener.id, {
      text: `${speaker.name} told me something about ${targetName}: "${rumor}"`,
      importance: 0.6, recency: 1, emotionalWeight: 0.4,
      involvedNpcIds: [speaker.id], aboutNpcIds: [targetId],
      type: "rumor_planted", sentiment: -0.3, timestamp: Date.now(),
    }, "shortTermMemory");

    this.memory.add(speaker.id, {
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
      let emotionDelta = { anger: 0, trust: 0, fear: 0, joy: 0, sadness: 0, curiosity: 0, disgust: 0, guilt: 0 };
      let sentiment = 0;

      switch (actionType) {
        case "give_gift": {
          memoryText = `I saw ${speaker.name} give ${listener.name} a gift: ${detail}`;
          sentiment = 0.2;
          const witRel = witness.relationships[speaker.id]?.regard ?? 0;
          if (witRel > 0.3) {
            emotionDelta = { anger: 0.03, trust: 0, fear: 0, joy: -0.02, sadness: 0.02, curiosity: 0, disgust: 0, guilt: 0 };
            sentiment = -0.1; // mild jealousy
          } else {
            emotionDelta = { anger: 0, trust: 0, fear: 0, joy: 0.02, sadness: 0, curiosity: 0, disgust: 0, guilt: 0 };
          }
          break;
        }
        case "mock": {
          memoryText = `I saw ${speaker.name} mock ${listener.name}: ${detail}`;
          sentiment = -0.3;
          this.store.applyRelationshipDelta(witnessId, speaker.id, -0.05);
          const witRelToVictim = witness.relationships[listener.id]?.regard ?? 0;
          if (witRelToVictim > -0.1) {
            this.store.applyRelationshipDelta(witnessId, listener.id, 0.03);
          }
          emotionDelta = { anger: 0.03, trust: -0.02, fear: 0.02, joy: -0.02, sadness: 0.02, curiosity: 0, disgust: 0.02, guilt: 0 };
          break;
        }
        case "storm_off":
          memoryText = `I saw ${speaker.name} storm off from ${listener.name}`;
          sentiment = -0.2;
          emotionDelta = { anger: 0, trust: 0, fear: 0.03, joy: -0.02, sadness: 0, curiosity: 0.02, disgust: 0, guilt: 0 };
          break;

        case "embrace": {
          memoryText = `I saw ${speaker.name} embrace ${listener.name}`;
          sentiment = 0.3;
          const witRelS = witness.relationships[speaker.id]?.regard ?? 0;
          const witRelL = witness.relationships[listener.id]?.regard ?? 0;
          if (witRelS > 0.4 || witRelL > 0.4) {
            emotionDelta = { anger: 0.03, trust: -0.02, fear: 0, joy: -0.03, sadness: 0.03, curiosity: 0, disgust: 0, guilt: 0 };
            sentiment = -0.15; // jealousy
            memoryText += " — I felt a pang of jealousy";
          } else {
            emotionDelta = { anger: 0, trust: 0, fear: 0, joy: 0.02, sadness: 0, curiosity: 0, disgust: 0, guilt: 0 };
          }
          break;
        }
        case "threaten":
          memoryText = `I saw ${speaker.name} threaten ${listener.name}: ${detail}`;
          sentiment = -0.4;
          this.store.applyRelationshipDelta(witnessId, speaker.id, -0.08);
          emotionDelta = { anger: 0.02, trust: -0.05, fear: 0.08, joy: -0.03, sadness: 0, curiosity: 0, disgust: 0.02, guilt: 0 };
          break;

        default:
          continue; // conspire and spread_rumor are not witnessed visually
      }

      this.store.applyEmotionDelta(witnessId, emotionDelta);

      this.memory.add(witnessId, {
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
    const relAB = npcA.relationships[npcBId]?.regard ?? 0;
    if (relAB > 0.6 && npcA.emotionalState.joy > 0.6 && !npcA.behavioralOverride) {
      this.store.setBehavioralOverride(npcAId, {
        mode: "seek",
        targetNpcId: npcBId,
        expiresAt: Date.now() + 45_000,
        reason: `Wants to stay near ${npcB.name} after a great conversation`,
      });
    }

    const relBA = npcB.relationships[npcAId]?.regard ?? 0;
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
    joy:       { pos: "#ffd54f", neg: "#b56576" },
    trust:     { pos: "#66bb6a", neg: "#7a8ba0" },
    anger:     { pos: "#ff7043", neg: "#4dd0e1" },
    fear:      { pos: "#ce93d8", neg: "#81d4fa" },
    sadness:   { pos: "#90a4ae", neg: "#ffcc80" },
    curiosity: { pos: "#4fc3f7", neg: "#bcaaa4" },
    disgust:   { pos: "#a1887f", neg: "#c5e1a5" },
    guilt:     { pos: "#b39ddb", neg: "#80cbc4" },
  };

  private logEmotionShifts(speaker: NPC, listener: NPC, response: LLMResponse): void {
    const d = response.emotion_delta;
    const shifts: string[] = [];

    const emotions: Array<{ key: string; val: number }> = [
      { key: "joy", val: d.joy },
      { key: "trust", val: d.trust },
      { key: "anger", val: d.anger },
      { key: "fear", val: d.fear },
      { key: "sadness", val: d.sadness },
      { key: "curiosity", val: d.curiosity },
      { key: "disgust", val: d.disgust },
      { key: "guilt", val: d.guilt },
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
    const relState = updatedSpeaker?.relationships[listener.id];
    const relValue = relState?.regard ?? 0;
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

    // Negative emotions take priority over positive (prevents "+disgust → now pleased")
    if (s.anger > 0.6) parts.push("angry");
    else if (s.anger > 0.3) parts.push("irritated");
    if (s.fear > 0.6) parts.push("fearful");
    else if (s.fear > 0.3) parts.push("uneasy");
    if (s.disgust > 0.5) parts.push("repulsed");
    else if (s.disgust > 0.25) parts.push("unsettled");
    if (s.guilt > 0.5) parts.push("guilt-ridden");
    if (s.sadness > 0.6) parts.push("melancholy");
    else if (s.sadness > 0.3) parts.push("downcast");
    if (s.trust < 0.3) parts.push("wary");

    // Only show positive mood if no significant negative emotions are present
    const hasNegative = parts.length > 0;
    if (!hasNegative) {
      if (s.joy > 0.7) parts.push("very happy");
      else if (s.joy > 0.5) parts.push("pleased");
      if (s.trust > 0.7) parts.push("very trusting");
      if (s.curiosity > 0.7) parts.push("very curious");
    } else {
      // Even with negative emotions, very high joy can show as mixed
      if (s.joy > 0.7) parts.push("but upbeat");
    }

    return parts.length > 0 ? parts.join(", ") : "calm";
  }

  private relationshipLabel(value: number): string {
    if (value > 0.5) return "close friend";
    if (value > 0.2) return "friendly";
    if (value > -0.2) return "neutral";
    if (value > -0.5) return "tense";
    return "hostile";
  }

  /**
   * Store one summary memory per NPC for the whole conversation,
   * instead of one per line of dialogue. Captures the emotional arc,
   * topics, and key moments.
   */
  private storeConversationSummaryMemory(
    npcAId: string,
    npcBId: string,
    session: ConversationSession
  ): void {
    const npcA = this.store.get(npcAId);
    const npcB = this.store.get(npcBId);
    if (!npcA || !npcB) return;

    // Calculate net emotional shift from the conversation
    let totalRelDelta = 0;
    let hadAction = false;
    const topics: string[] = [];

    for (const msg of session.messages) {
      const r = msg.rawResponse;
      if (!r) continue;
      totalRelDelta += r.relationship_delta;
      if (r.action) hadAction = true;
      // Grab a few key speech snippets for topic summary (first, mid, last)
    }

    const avgSentiment = totalRelDelta / Math.max(1, session.messages.length);
    const toneWord =
      avgSentiment > 0.03 ? "warm" :
      avgSentiment < -0.03 ? "tense" :
      "neutral";

    // Pick 1-2 representative quotes (first speaker line + last line)
    const firstMsg = session.messages[0];
    const lastMsg = session.messages[session.messages.length - 1];

    const buildSummary = (selfId: string, otherName: string) => {
      const myMsgs = session.messages.filter(m => m.npcId === selfId);
      const theirMsgs = session.messages.filter(m => m.npcId !== selfId);
      const myLastSpeech = myMsgs[myMsgs.length - 1]?.text;
      const theirLastSpeech = theirMsgs[theirMsgs.length - 1]?.text;

      let summary = `I had a ${toneWord} conversation with ${otherName} (${session.turnCount} turns).`;
      if (theirLastSpeech) {
        const truncated = theirLastSpeech.length > 80
          ? theirLastSpeech.slice(0, 77) + "..."
          : theirLastSpeech;
        summary += ` They said: "${truncated}"`;
      }
      if (hadAction) summary += " Something significant happened.";
      return summary;
    };

    const importance = Math.min(1, Math.abs(totalRelDelta) * 3 + (hadAction ? 0.3 : 0) + 0.2);

    // NPC A's memory
    this.memory.add(
      npcAId,
      {
        text: buildSummary(npcAId, npcB.name),
        importance,
        recency: 1,
        emotionalWeight: Math.min(1, Math.abs(totalRelDelta) * 5),
        involvedNpcIds: [npcBId],
        timestamp: Date.now(),
        type: "conversation",
        aboutNpcIds: [],
        sentiment: avgSentiment > 0 ? 0.3 : avgSentiment < 0 ? -0.3 : 0,
      },
      "shortTermMemory"
    );

    // NPC B's memory
    this.memory.add(
      npcBId,
      {
        text: buildSummary(npcBId, npcA.name),
        importance,
        recency: 1,
        emotionalWeight: Math.min(1, Math.abs(totalRelDelta) * 5),
        involvedNpcIds: [npcAId],
        timestamp: Date.now(),
        type: "conversation",
        aboutNpcIds: [],
        sentiment: avgSentiment > 0 ? 0.3 : avgSentiment < 0 ? -0.3 : 0,
      },
      "shortTermMemory"
    );
  }

  private logConversationSummary(npcAId: string, npcBId: string): void {
    const a = this.store.get(npcAId);
    const b = this.store.get(npcBId);
    if (!a || !b) return;

    const relAB = a.relationships[npcBId]?.regard ?? 0;
    const relBA = b.relationships[npcAId]?.regard ?? 0;
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
        sadness: 0,
        curiosity: 0,
        disgust: 0,
        guilt: 0,
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
   * Weighted random turn count based on conversation type.
   * Uses triangular distribution biased toward the middle of the range.
   */
  private rollMaxTurns(convType: ConversationType = "casual"): number {
    const [min, max] = TURN_LIMITS[convType] ?? [this.MIN_TURNS, this.MAX_TURNS];
    const range = max - min;
    // Average of two uniform randoms → triangular-ish distribution centered in range
    const r = (Math.random() + Math.random()) / 2;
    return min + Math.round(r * range);
  }

  private classifyConversationType(a: NPC, b: NPC): ConversationType {
    const relAB = a.relationships[b.id]?.regard ?? 0;
    const relBA = b.relationships[a.id]?.regard ?? 0;
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
    const aHasGossip = this.memory.hasGossip(a.id);
    const bHasGossip = this.memory.hasGossip(b.id);
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

      this.memory.add(
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

      // Visible reaction based on relationship to the speakers
      const relToSpeaker = eavesdropper.relationships[speaker.id]?.regard ?? 0;
      const relToListener = eavesdropper.relationships[listener.id]?.regard ?? 0;
      const avgRel = (relToSpeaker + relToListener) / 2;
      const traits = eavesdropper.personalityTraits.map(t => t.toLowerCase());

      let reaction: string;
      if (traits.includes("curious") || traits.includes("perceptive")) {
        reaction = "👂 listening intently...";
      } else if (avgRel > 0.3) {
        reaction = "🤔 overhearing friends talk...";
      } else if (avgRel < -0.2) {
        reaction = "😒 overhearing them talk...";
        // Leave if they dislike both speakers
        if (!eavesdropper.behavioralOverride && relToSpeaker < -0.1 && relToListener < -0.1) {
          this.store.setBehavioralOverride(eavesdropperId, {
            mode: "avoid",
            targetNpcId: speaker.id,
            expiresAt: Date.now() + 30_000,
            reason: "didn't want to hear that conversation",
          });
        }
      } else {
        reaction = "👀 overhearing a conversation...";
      }

      this.callbacks.onEavesdropReaction?.(eavesdropperId, reaction);
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

          this.memory.add(
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
        } catch (err) {
          console.warn(`[reflection] ${npc.name} reflection failed:`, err);
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
