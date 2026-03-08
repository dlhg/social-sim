/**
 * TTS Service — talks to the local Kokoro TTS server.
 *
 * Handles voice assignment per NPC, audio queuing, and playback
 * through the Web Audio API. Passes NPC emotional state to the server
 * for emotion-aware speed modulation and voice blending.
 */

import type { EmotionalState } from "./types";

const TTS_BASE = "http://localhost:8787";

// ── Voice pool (must match server's VOICE_POOL) ─────────
const VOICE_POOL = [
  "voice_01",
  "voice_02",
  "voice_03",
  "voice_04",
  "voice_05",
  "voice_06",
  "voice_07",
  "voice_08",
  "voice_09",
  "voice_10",
  "voice_11",
  "voice_12",
  "voice_13",
];

export type TTSEngine = "chatterbox" | "kokoro";

export interface TTSOptions {
  /** 0 = muted, 1 = full volume */
  volume: number;
  /** Playback speed multiplier */
  speed: number;
  /** Whether TTS is enabled at all */
  enabled: boolean;
  /** Which TTS engine to use (default: auto based on language) */
  engine?: TTSEngine;
}

const DEFAULT_OPTIONS: TTSOptions = {
  volume: 0.7,
  speed: 1.1,
  enabled: true,
};

export class TTSService {
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private voiceMap = new Map<string, string>(); // npcId -> voice
  private voiceIndex = 0;
  private queue: { npcId: string; text: string; emotions?: EmotionalState; language?: string; resolve: () => void }[] = [];
  private playing = false;
  private options: TTSOptions;
  private serverAvailable: boolean | null = null; // null = unknown
  private currentSource: AudioBufferSourceNode | null = null;

  constructor(options?: Partial<TTSOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** Check if the TTS server is running */
  async checkServer(): Promise<boolean> {
    try {
      const res = await fetch(`${TTS_BASE}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      this.serverAvailable = res.ok;
    } catch {
      this.serverAvailable = false;
    }
    return this.serverAvailable;
  }

  /** Assign a consistent voice to an NPC */
  assignVoice(npcId: string): string {
    let voice = this.voiceMap.get(npcId);
    if (!voice) {
      voice = VOICE_POOL[this.voiceIndex % VOICE_POOL.length];
      this.voiceIndex++;
      this.voiceMap.set(npcId, voice);
    }
    return voice;
  }

  /** Get the voice assigned to an NPC (or assign one) */
  getVoice(npcId: string): string {
    return this.assignVoice(npcId);
  }

  /** Update options at runtime */
  setOptions(opts: Partial<TTSOptions>) {
    Object.assign(this.options, opts);
    if (this.gainNode) {
      this.gainNode.gain.value = this.options.volume;
    }
  }

  /** Call from a user gesture (e.g. button click) to unlock audio playback */
  warmUp() {
    this.ensureAudioContext();
  }

  /** Speak a line of text for an NPC. Optionally pass emotional state for expressive synthesis. */
  async speak(npcId: string, text: string, emotions?: EmotionalState, language?: string): Promise<void> {
    if (!this.options.enabled || this.serverAvailable === false) return;

    // Lazy check server on first call
    if (this.serverAvailable === null) {
      await this.checkServer();
      if (!this.serverAvailable) return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push({ npcId, text, emotions, language, resolve });
      this.processQueue();
    });
  }

  /** Stop current playback and clear the queue */
  stop() {
    this.queue = [];
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch { /* already stopped */ }
      this.currentSource = null;
    }
    this.playing = false;
  }

  /** Clean up resources */
  destroy() {
    this.stop();
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
  }

  // ── Private ────────────────────────────────────

  private ensureAudioContext() {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext({ sampleRate: 24000 });
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = this.options.volume;
      this.gainNode.connect(this.audioCtx.destination);
    }
    // Resume if suspended (browser autoplay policy)
    if (this.audioCtx.state === "suspended") {
      this.audioCtx.resume();
    }
  }

  private async processQueue() {
    if (this.playing || this.queue.length === 0) return;
    this.playing = true;

    const item = this.queue.shift()!;
    const voice = this.assignVoice(item.npcId);

    try {
      const wavBytes = await this.fetchSpeech(item.text, voice, item.emotions, item.language);
      if (wavBytes) {
        await this.playAudio(wavBytes);
      }
    } catch (err) {
      console.warn("[tts] playback error:", err);
    }

    item.resolve();
    this.playing = false;

    // Process next in queue
    if (this.queue.length > 0) {
      this.processQueue();
    }
  }

  private async fetchSpeech(
    text: string,
    voice: string,
    emotions?: EmotionalState,
    language?: string,
  ): Promise<ArrayBuffer | null> {
    try {
      const res = await fetch(`${TTS_BASE}/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice,
          speed: this.options.speed,
          emotions: emotions ?? undefined,
          language: language ?? undefined,
          engine: this.options.engine ?? undefined,
        }),
        signal: AbortSignal.timeout(300000),
      });

      if (!res.ok) {
        console.warn(`[tts] server returned ${res.status}`);
        return null;
      }

      return await res.arrayBuffer();
    } catch (err) {
      console.warn("[tts] fetch error:", err);
      return null;
    }
  }

  private async playAudio(wavBytes: ArrayBuffer): Promise<void> {
    this.ensureAudioContext();
    const ctx = this.audioCtx!;
    const gain = this.gainNode!;

    const audioBuffer = await ctx.decodeAudioData(wavBytes.slice(0));
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gain);
    this.currentSource = source;

    return new Promise<void>((resolve) => {
      source.onended = () => {
        this.currentSource = null;
        resolve();
      };
      source.start();
    });
  }
}
