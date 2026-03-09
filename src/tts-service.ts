/**
 * TTS Service — talks to the local Kokoro TTS server.
 *
 * Handles voice assignment per NPC, audio queuing, and playback
 * through the Web Audio API. Passes NPC emotional state to the server
 * for emotion-aware speed modulation and voice blending.
 */

import type { EmotionalState } from "./types";

const TTS_BASE = "http://localhost:8787";

// ── Paralinguistic tag sanitization ─────────
// Only these tags are supported by Chatterbox TTS
const SUPPORTED_TAGS = new Set([
  "clear throat", "sigh", "shush", "cough", "groan",
  "sniff", "gasp", "chuckle", "laugh",
]);

/** Strip unsupported paralinguistic tags (e.g. [smiles], [nods]) from speech text */
function sanitizeTags(text: string): string {
  return text.replace(/\[([^\]]+)\]/g, (match, tag) => {
    return SUPPORTED_TAGS.has(tag.trim().toLowerCase()) ? match : "";
  });
}

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

  /** Set a custom voice for an NPC (bypasses the pool round-robin) */
  setCustomVoice(npcId: string, voiceId: string): void {
    this.voiceMap.set(npcId, voiceId);
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

  /** Pre-fetch TTS audio without queuing playback. Returns raw WAV bytes. */
  async prefetch(npcId: string, text: string, emotions?: EmotionalState, language?: string): Promise<ArrayBuffer | null> {
    if (!this.options.enabled || this.serverAvailable === false) return null;

    if (this.serverAvailable === null) {
      await this.checkServer();
      if (!this.serverAvailable) return null;
    }

    const voice = this.assignVoice(npcId);
    return this.fetchSpeech(text, voice, emotions, language);
  }

  /** Play a pre-fetched audio buffer. Returns a promise that resolves when playback ends. */
  async playBuffer(buffer: ArrayBuffer): Promise<void> {
    if (!this.options.enabled) return;
    // Wait for any queued speech to finish first
    while (this.playing) {
      await new Promise(r => setTimeout(r, 50));
    }
    this.playing = true;
    try {
      await this.playAudio(buffer);
    } finally {
      this.playing = false;
    }
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
    const cleanText = sanitizeTags(text);
    try {
      const res = await fetch(`${TTS_BASE}/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: cleanText,
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

export interface VoiceInfo {
  id: string;
  name: string;
  custom: boolean;
}

/** Fetch the list of available voices from the TTS server. */
export async function fetchVoices(): Promise<VoiceInfo[]> {
  try {
    const res = await fetch(`${TTS_BASE}/voices`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const raw: unknown[] = data.voices ?? [];
    // Normalize: server may return strings (old) or objects (new)
    return raw.map((v) => {
      if (typeof v === "string") {
        return { id: v, name: v, custom: v.startsWith("custom_") };
      }
      return v as VoiceInfo;
    });
  } catch {
    return [];
  }
}

/** Get the URL for a voice's pre-rendered preview clip. */
export function getVoicePreviewUrl(voiceId: string): string {
  return `${TTS_BASE}/voice-preview/${voiceId}`;
}

/** Extract audio from a YouTube URL for voice cloning. */
export async function youtubeVoiceClip(
  url: string,
  start: number,
  end: number,
  voiceId: string,
): Promise<{ voice_id: string; duration_seconds: number } | null> {
  try {
    const res = await fetch(`${TTS_BASE}/youtube-voice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, start, end, voice_id: voiceId }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text);
    }
    return await res.json();
  } catch (err) {
    console.warn("[tts] youtube voice error:", err);
    return null;
  }
}

/** Delete a custom voice from the TTS server. */
export async function deleteVoice(voiceId: string): Promise<boolean> {
  try {
    const res = await fetch(`${TTS_BASE}/voice/${voiceId}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Upload a voice reference clip to the TTS server for Chatterbox voice cloning. */
export async function uploadVoiceClip(
  audioBlob: Blob,
  voiceId: string,
): Promise<{ voice_id: string; duration_seconds: number } | null> {
  const formData = new FormData();
  formData.append("file", audioBlob, `${voiceId}.wav`);
  formData.append("voice_id", voiceId);

  try {
    const res = await fetch(`${TTS_BASE}/upload-voice`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
