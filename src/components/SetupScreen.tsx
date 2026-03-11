import { useState, useRef, useEffect } from "react";
import { createNpc, randomizeFields, randomizeNpc, COLOR_SWATCHES, RANDOM_ITEMS } from "../npcs";
import type { NPC, InventoryItem, ItemCategory, EmotionalState } from "../types";
import { ITEM_LIFETIME_BY_CATEGORY } from "../types";
import { SPRITE_NAMES } from "../sprite-system";
import type { SpriteName } from "../sprite-system";
import {
  ensurePremadeSeeded,
  loadCustomPremades,
  saveCustomPremade,
  deleteCustomPremade,
  premadeTemplateToNpc,
  npcToPremadeTemplate,
} from "../premade-storage";
import type { PremadeTemplate } from "../premade-storage";
import type { LlmProvider, LlmConfig } from "../llm-config";
import { GROQ_MODELS, GEMINI_MODELS } from "../llm-config";
import { uploadVoiceClip, fetchVoices, getVoicePreviewUrl, deleteVoice, youtubeVoiceClip } from "../tts-service";
import type { VoiceInfo } from "../tts-service";
import { accumulateChat } from "../ollama";
import { NpcStore } from "../npc-store";

const MAX_ROSTER = 13;

const LANGUAGES = [
  { code: "English", label: "English" },
  { code: "Chinese", label: "Chinese" },
  { code: "Japanese", label: "Japanese" },
  { code: "Korean", label: "Korean" },
  { code: "French", label: "French" },
  { code: "Spanish", label: "Spanish" },
  { code: "German", label: "German" },
  { code: "Portuguese", label: "Portuguese" },
  { code: "Russian", label: "Russian" },
  { code: "Arabic", label: "Arabic" },
  { code: "Italian", label: "Italian" },
  { code: "Thai", label: "Thai" },
];

type TTSEngine = "chatterbox" | "kokoro";

const MAPS = [
  { url: "/assets/levels/village.tmj", label: "Village", description: "30 narrative waypoints, no art" },
  { url: "/assets/levels/testmap.tmj", label: "Test Map", description: "Original tilemap with art" },
];

const CATEGORY_ORDER: ItemCategory[] = ["food", "herb", "fish", "trinket", "craft", "book"];
const CATEGORY_COLORS: Record<string, string> = {
  food: "#e0a84c", herb: "#5cb87a", fish: "#6ba4d4",
  trinket: "#a876c4", book: "#9e8878", craft: "#e0c84c",
};

const SPRITE_URL = (name: string) =>
  `/assets/Modern%20tiles_Free/Characters_free/${name}_idle_anim_16x16.png`;

interface SetupScreenProps {
  roster: NPC[];
  language: string;
  ttsEngine: TTSEngine;
  llmConfig: LlmConfig;
  mapUrl: string;
  onMapChange: (url: string) => void;
  onAddToRoster: (npc: NPC) => void;
  onRemoveFromRoster: (npcId: string) => void;
  onLanguageChange: (language: string) => void;
  onTtsEngineChange: (engine: TTSEngine) => void;
  onLlmConfigChange: (updates: Partial<LlmConfig>) => void;
  onTestTts: (text: string, engine: TTSEngine) => void;
  onStartSimulation: () => void;
  onTestMap?: () => void;
}

export function SetupScreen({
  roster,
  language,
  ttsEngine,
  llmConfig,
  onAddToRoster,
  onRemoveFromRoster,
  onLanguageChange,
  onTtsEngineChange,
  mapUrl,
  onMapChange,
  onLlmConfigChange,
  onTestTts,
  onStartSimulation,
  onTestMap,
}: SetupScreenProps) {
  // ── Premade / gallery state ──────────────────────
  const [customPremades, setCustomPremades] = useState<PremadeTemplate[]>(() => {
    ensurePremadeSeeded();
    return loadCustomPremades();
  });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [testPhrase, setTestPhrase] = useState("");
  const [testPlaying, setTestPlaying] = useState(false);
  const testTimeout = useRef<number | null>(null);

  // ── Template hover/select state ─────────────────
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [previewTemplateId, setPreviewTemplateId] = useState<string | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

  // ── Inline character builder state ──────────────
  const [name, setName] = useState("");
  const [color, setColor] = useState("#4dd0e1");
  const [spriteId, setSpriteId] = useState<string>(SPRITE_NAMES[0]);
  const [traits, setTraits] = useState("");
  const [desires, setDesires] = useState("");
  const [backstory, setBackstory] = useState("");
  const [secrets, setSecrets] = useState("");
  const [inventory, setInventory] = useState<InventoryItem[]>([]);

  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emotionalStateOverride, setEmotionalStateOverride] = useState<Partial<EmotionalState> | undefined>();
  const [baselinesMode, setBaselinesMode] = useState<"default" | "derive" | "manual">("default");
  const [baselines, setBaselines] = useState<Partial<EmotionalState> | undefined>();
  const [isDeriving, setIsDeriving] = useState(false);

  // ── Voice cloning state ─────────────────────────
  const [customVoiceId, setCustomVoiceId] = useState<string | undefined>();
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isTesting, setIsTesting] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const testAudioCtxRef = useRef<AudioContext | null>(null);
  const [availableVoices, setAvailableVoices] = useState<VoiceInfo[]>([]);
  const [voiceMode, setVoiceMode] = useState<"auto" | "select" | "custom">("auto");
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | undefined>();
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [ytUrl, setYtUrl] = useState("");
  const [ytStartMin, setYtStartMin] = useState("0");
  const [ytStartSec, setYtStartSec] = useState("0");
  const [ytEndMin, setYtEndMin] = useState("0");
  const [ytEndSec, setYtEndSec] = useState("30");
  const [ytLoading, setYtLoading] = useState(false);

  const hasExistingVoice = voiceMode === "custom" && !!customVoiceId && !audioBlob;

  // Fetch voices on mount
  useEffect(() => {
    fetchVoices().then(setAvailableVoices);
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (testTimeout.current) clearTimeout(testTimeout.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (timerRef.current) clearInterval(timerRef.current);
      if (testAudioCtxRef.current) testAudioCtxRef.current.close();
      if (previewAudioRef.current) { previewAudioRef.current.pause(); previewAudioRef.current = null; }
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ─────────────────────────────────────
  const rosterIds = new Set(roster.map((n) => n.id));
  const atCapacity = roster.length >= MAX_ROSTER;
  const savedPremadeIds = new Set(customPremades.map((t) => t.id));
  const derivedId = name.trim().toLowerCase().replace(/\s+/g, "-");
  const isDuplicate = derivedId !== "" && roster.some((n) => n.id === derivedId);

  const lang = language.toLowerCase().trim();
  const isEnglish = lang === "english" || lang === "british english";

  // ── Derived: active template and change detection ──
  const activeTemplate = activeTemplateId
    ? customPremades.find((t) => t.id === activeTemplateId) ?? null
    : null;

  const hasTemplateChanges = (() => {
    if (!activeTemplate) return false;
    if (name !== activeTemplate.name) return true;
    if (color !== activeTemplate.color) return true;
    if (spriteId !== (activeTemplate.spriteId || SPRITE_NAMES[0])) return true;
    if ((backstory || "") !== (activeTemplate.backstory ?? "")) return true;

    const curTraits = traits.split(",").map((t) => t.trim()).filter(Boolean);
    if (curTraits.length !== activeTemplate.personalityTraits.length ||
        curTraits.some((t, i) => t !== activeTemplate.personalityTraits[i])) return true;

    const curDesires = desires.split(",").map((d) => d.trim()).filter(Boolean);
    if (curDesires.length !== activeTemplate.coreDesires.length ||
        curDesires.some((d, i) => d !== activeTemplate.coreDesires[i])) return true;

    const curSecrets = secrets.split("\n").map((s) => s.trim()).filter(Boolean);
    if (curSecrets.length !== activeTemplate.secrets.length ||
        curSecrets.some((s, i) => s !== activeTemplate.secrets[i])) return true;

    const curInvLabels = inventory.map((i) => i.label).sort();
    const tmplInvLabels = activeTemplate.inventory.map((i) => i.label).sort();
    if (curInvLabels.length !== tmplInvLabels.length ||
        curInvLabels.some((l, i) => l !== tmplInvLabels[i])) return true;

    const effectiveVoiceId = voiceMode === "select" ? selectedVoiceId
      : voiceMode === "custom" ? customVoiceId
      : undefined;
    if ((effectiveVoiceId || undefined) !== (activeTemplate.customVoiceId || undefined)) return true;
    if (audioBlob) return true;

    return false;
  })();

  // Which template data to show in the form (preview on hover, or actively loaded)
  const displayTemplateId = previewTemplateId || activeTemplateId;

  // ── Premade helpers ─────────────────────────────
  function refreshPremades() { setCustomPremades(loadCustomPremades()); }

  function handleSaveAsPremade(npc: NPC) {
    saveCustomPremade(npcToPremadeTemplate(npc));
    refreshPremades();
  }

  async function handleSaveTemplate() {
    if (!activeTemplate || !hasTemplateChanges) return;
    const trimmedName = name.trim();
    if (!trimmedName) { setFormError("Name is required"); return; }

    const parsedTraits = traits.split(",").map((t) => t.trim()).filter(Boolean);
    const parsedDesires = desires.split(",").map((d) => d.trim()).filter(Boolean);
    const parsedSecrets = secrets.split("\n").map((s) => s.trim()).filter(Boolean);

    let finalVoiceId: string | undefined;
    if (voiceMode === "select" && selectedVoiceId) {
      finalVoiceId = selectedVoiceId;
    } else if (voiceMode === "custom") {
      finalVoiceId = customVoiceId;
      if (audioBlob && !customVoiceId) {
        setIsSubmitting(true);
        const vid = `custom_${activeTemplate.id}`;
        const result = await uploadVoiceClip(audioBlob, vid);
        setIsSubmitting(false);
        if (!result) { setFormError("Failed to upload voice clip."); return; }
        finalVoiceId = result.voice_id;
        setCustomVoiceId(finalVoiceId);
      }
    }

    const updated: PremadeTemplate = {
      ...activeTemplate,
      name: trimmedName,
      color,
      spriteId,
      personalityTraits: parsedTraits,
      coreDesires: parsedDesires,
      backstory: backstory.trim() || undefined,
      secrets: parsedSecrets,
      inventory: inventory.map((i) => ({ ...i })),
      emotionalState: emotionalStateOverride,
      emotionalBaselines: baselinesMode !== "default" ? baselines : undefined,
      customVoiceId: finalVoiceId,
    };

    saveCustomPremade(updated);
    refreshPremades();
    setAudioBlob(null);
  }

  function handleConfirmDelete() {
    if (confirmDeleteId) {
      deleteCustomPremade(confirmDeleteId);
      refreshPremades();
      setConfirmDeleteId(null);
    }
  }

  // ── Form helpers ────────────────────────────────
  function fillFormFromTemplate(template: PremadeTemplate) {
    setName(template.name);
    setColor(template.color);
    setSpriteId(template.spriteId || SPRITE_NAMES[0]);
    setTraits(template.personalityTraits.join(", "));
    setDesires(template.coreDesires.join(", "));
    setBackstory(template.backstory ?? "");
    setSecrets(template.secrets.join("\n"));
    setInventory(template.inventory.map((i) => ({ ...i })));
    setEmotionalStateOverride(template.emotionalState);
    setBaselines(template.emotionalBaselines);
    setBaselinesMode(template.emotionalBaselines ? "manual" : "default");
    setCustomVoiceId(template.customVoiceId);
    setVoiceMode(
      template.customVoiceId
        ? template.customVoiceId.startsWith("custom_") ? "custom" : "select"
        : "auto"
    );
    setSelectedVoiceId(
      template.customVoiceId && !template.customVoiceId.startsWith("custom_")
        ? template.customVoiceId : undefined
    );
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setFormError("");
  }

  function clearForm() {
    setName("");
    setColor("#4dd0e1");
    setSpriteId(SPRITE_NAMES[0]);
    setTraits("");
    setDesires("");
    setBackstory("");
    setSecrets("");
    setInventory([]);
    setEmotionalStateOverride(undefined);
    setBaselines(undefined);
    setBaselinesMode("default");
    setCustomVoiceId(undefined);
    setVoiceMode("auto");
    setSelectedVoiceId(undefined);
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setFormError("");
    setActiveTemplateId(null);
  }

  function handleRandomize() {
    const r = randomizeFields(roster.map((n) => n.id));
    setName(r.name);
    setColor(r.color);
    setSpriteId(r.spriteId);
    setTraits(r.traits.join(", "));
    setDesires(r.desires.join(", "));
    setBackstory(r.backstory);
    setSecrets(r.secrets.join("\n"));
    setInventory(r.inventory);
    setEmotionalStateOverride(undefined);
    setBaselines(undefined);
    setBaselinesMode("default");
    setActiveTemplateId(null);
    setFormError("");
  }

  async function handleDeriveBaselines() {
    const parsedTraits = traits.split(",").map((t) => t.trim()).filter(Boolean);
    if (parsedTraits.length === 0) { setFormError("Add personality traits first"); return; }
    setIsDeriving(true);
    try {
      const prompt = `Given an NPC character with these traits: ${parsedTraits.join(", ")}${
        backstory ? `\nBackstory: ${backstory.trim()}` : ""
      }

Suggest emotional baselines — the resting emotional state this character naturally returns to over time. These are NOT current emotions, but their default equilibrium.

Respond with ONLY a JSON object with these 7 keys, values from 0.0 to 1.0:
{"anger": 0.0, "trust": 0.0, "fear": 0.0, "joy": 0.0, "sadness": 0.0, "curiosity": 0.0, "guilt": 0.0}

Guidelines:
- Most values should be 0.1-0.5 (moderate baselines)
- An optimistic character might have joy: 0.5, anger: 0.1
- An anxious character might have fear: 0.4, trust: 0.2
- A cynical character might have trust: 0.15, joy: 0.25
- Only go above 0.6 for truly extreme personality traits`;

      const raw = await accumulateChat([{ role: "user", content: prompt }]);
      const match = raw.match(/\{[^}]+\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        const result: Partial<EmotionalState> = {};
        for (const key of ["anger", "trust", "fear", "joy", "sadness", "curiosity", "guilt"] as const) {
          const v = parseFloat(parsed[key]);
          if (!isNaN(v)) result[key] = Math.max(0, Math.min(1, v));
        }
        setBaselines(result);
        setBaselinesMode("manual"); // show the sliders with derived values for tweaking
      }
    } catch (e) {
      console.warn("[SetupScreen] Failed to derive baselines:", e);
      setFormError("Failed to derive baselines — is the LLM running?");
    }
    setIsDeriving(false);
  }

  // ── Template hover/click ────────────────────────
  // Store form state before preview so we can revert
  const preHoverState = useRef<{
    name: string; color: string; spriteId: string;
    traits: string; desires: string; backstory: string; secrets: string;
    inventory: InventoryItem[]; emotionalState?: Partial<EmotionalState>;
  } | null>(null);

  function handleTemplateHover(template: PremadeTemplate) {
    if (activeTemplateId) return; // don't preview if a template is actively loaded
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      // Save current form state before overwriting
      if (!preHoverState.current) {
        preHoverState.current = {
          name, color, spriteId, traits, desires, backstory, secrets,
          inventory: [...inventory], emotionalState: emotionalStateOverride,
        };
      }
      setPreviewTemplateId(template.id);
      fillFormFromTemplate(template);
    }, 150);
  }

  function handleTemplateLeave() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    if (previewTemplateId && preHoverState.current && !activeTemplateId) {
      // Revert form to pre-hover state
      const s = preHoverState.current;
      setName(s.name);
      setColor(s.color);
      setSpriteId(s.spriteId);
      setTraits(s.traits);
      setDesires(s.desires);
      setBackstory(s.backstory);
      setSecrets(s.secrets);
      setInventory(s.inventory);
      setEmotionalStateOverride(s.emotionalState);
      preHoverState.current = null;
    }
    setPreviewTemplateId(null);
  }

  function handleTemplateClick(template: PremadeTemplate) {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    preHoverState.current = null;
    setPreviewTemplateId(null);
    setActiveTemplateId(template.id);
    fillFormFromTemplate(template);
  }

  function handleQuickAdd(template: PremadeTemplate) {
    if (atCapacity || rosterIds.has(template.id)) return;
    onAddToRoster(premadeTemplateToNpc(template));
  }

  // ── Inventory helpers ───────────────────────────
  function addItem(item: typeof RANDOM_ITEMS[number]) {
    if (inventory.length >= 8) return;
    setInventory((prev) => [...prev, {
      id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      label: item.label, category: item.category, emoji: item.emoji,
      acquiredAt: Date.now(), lifetimeMs: ITEM_LIFETIME_BY_CATEGORY[item.category],
    }]);
  }

  function removeItem(itemId: string) {
    setInventory((prev) => prev.filter((i) => i.id !== itemId));
  }

  const itemsByCategory = CATEGORY_ORDER
    .map((cat) => ({ category: cat, items: RANDOM_ITEMS.filter((i) => i.category === cat) }))
    .filter((g) => g.items.length > 0);

  // ── Voice helpers (same as NpcCreator) ──────────
  async function convertToWav(blob: Blob): Promise<Blob> {
    const audioCtx = new AudioContext({ sampleRate: 24000 });
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const length = Math.min(audioBuffer.length, 24000 * 30);
    const wavBuffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(wavBuffer);
    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeStr(0, "RIFF"); view.setUint32(4, 36 + length * 2, true);
    writeStr(8, "WAVE"); writeStr(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, 24000, true);
    view.setUint32(28, 48000, true); view.setUint16(32, 2, true);
    view.setUint16(34, 16, true); writeStr(36, "data");
    view.setUint32(40, length * 2, true);
    const channelData = audioBuffer.getChannelData(0);
    let offset = 44;
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset, sample * 32767, true);
      offset += 2;
    }
    audioCtx.close();
    return new Blob([wavBuffer], { type: "audio/wav" });
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const rawBlob = new Blob(chunksRef.current, { type: recorder.mimeType });
        stream.getTracks().forEach((t) => t.stop());
        try {
          const wavBlob = await convertToWav(rawBlob);
          setAudioBlob(wavBlob);
          if (audioUrl) URL.revokeObjectURL(audioUrl);
          setAudioUrl(URL.createObjectURL(wavBlob));
          setCustomVoiceId(undefined);
        } catch (err) {
          setFormError("Failed to process recording");
          console.warn("[voice] conversion error:", err);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = window.setInterval(() => setRecordingTime((prev) => prev + 1), 1000);
      setTimeout(() => stopRecording(), 30000);
    } catch { setFormError("Microphone access denied"); }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    setIsRecording(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("audio/") && !file.name.match(/\.(wav|mp3|m4a|ogg|webm)$/i)) {
      setFormError("Please upload an audio file"); return;
    }
    try {
      const wavBlob = await convertToWav(file);
      setAudioBlob(wavBlob);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(URL.createObjectURL(wavBlob));
      setCustomVoiceId(undefined);
      setFormError("");
    } catch (err) {
      setFormError("Could not process audio file");
      console.warn("[voice] upload conversion error:", err);
    }
  }

  function clearVoice() {
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setCustomVoiceId(undefined);
  }

  async function handleYoutubeExtract() {
    if (!ytUrl.trim()) { setFormError("Enter a YouTube URL"); return; }
    const start = (parseFloat(ytStartMin) || 0) * 60 + (parseFloat(ytStartSec) || 0);
    const end = (parseFloat(ytEndMin) || 0) * 60 + (parseFloat(ytEndSec) || 0);
    if (end <= start) { setFormError("End time must be after start time"); return; }
    setYtLoading(true); setFormError("");
    const currentId = name.trim().toLowerCase().replace(/\s+/g, "-");
    const voiceId = `custom_${currentId || "yt_" + Date.now()}`;
    const result = await youtubeVoiceClip(ytUrl.trim(), start, end, voiceId);
    setYtLoading(false);
    if (!result) { setFormError("Failed to extract audio from YouTube."); return; }
    setCustomVoiceId(result.voice_id);
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    try {
      const clipRes = await fetch(`http://localhost:8787/voice-clip/${result.voice_id}`);
      if (clipRes.ok) { const blob = await clipRes.blob(); setAudioUrl(URL.createObjectURL(blob)); }
    } catch { /* preview will still work via Test button */ }
  }

  async function playPreview(voiceId: string) {
    if (previewAudioRef.current) { previewAudioRef.current.pause(); previewAudioRef.current = null; }
    if (previewingVoice === voiceId) { setPreviewingVoice(null); return; }
    setPreviewingVoice(voiceId);
    try {
      const res = await fetch(getVoicePreviewUrl(voiceId), { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => { setPreviewingVoice(null); previewAudioRef.current = null; URL.revokeObjectURL(url); };
      audio.play();
    } catch { setPreviewingVoice(null); setFormError("Preview not available — is the TTS server running?"); }
  }

  async function handleDeleteVoice(voiceId: string) {
    const ok = await deleteVoice(voiceId);
    if (ok) {
      setAvailableVoices((prev) => prev.filter((v) => v.id !== voiceId));
      if (selectedVoiceId === voiceId) setSelectedVoiceId(undefined);
    } else { setFormError("Failed to delete voice"); }
  }

  async function handleTestVoice() {
    setIsTesting(true);
    const currentId = name.trim().toLowerCase().replace(/\s+/g, "-");
    let voiceId = customVoiceId;
    if (!voiceId && audioBlob) {
      const tempId = `custom_${currentId || "test_" + Date.now()}`;
      const result = await uploadVoiceClip(audioBlob, tempId);
      if (!result) { setFormError("Could not upload voice for testing."); setIsTesting(false); return; }
      voiceId = result.voice_id;
      setCustomVoiceId(voiceId);
    }
    if (!voiceId) { setIsTesting(false); return; }
    try {
      const res = await fetch("http://localhost:8787/speak", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Hello there! This is what I sound like.", voice: voiceId, speed: 1.0, engine: "chatterbox" }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const wavBytes = await res.arrayBuffer();
        const ctx = new AudioContext({ sampleRate: 24000 });
        testAudioCtxRef.current = ctx;
        const ab = await ctx.decodeAudioData(wavBytes);
        const source = ctx.createBufferSource();
        source.buffer = ab; source.connect(ctx.destination);
        source.onended = () => { setIsTesting(false); ctx.close(); testAudioCtxRef.current = null; };
        source.start();
      } else { setFormError("Voice test failed"); setIsTesting(false); }
    } catch { setFormError("TTS server not available"); setIsTesting(false); }
  }

  // ── Submit (Add to Roster) ──────────────────────
  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) { setFormError("Name is required"); return; }
    if (isDuplicate) { setFormError("An NPC with that name already exists"); return; }
    const parsedTraits = traits.split(",").map((t) => t.trim()).filter(Boolean);
    const parsedDesires = desires.split(",").map((d) => d.trim()).filter(Boolean);
    if (parsedTraits.length === 0) { setFormError("Add at least one personality trait"); return; }
    if (parsedDesires.length === 0) { setFormError("Add at least one core desire"); return; }
    const parsedSecrets = secrets.split("\n").map((s) => s.trim()).filter(Boolean);

    let finalVoiceId: string | undefined;
    if (voiceMode === "select" && selectedVoiceId) {
      finalVoiceId = selectedVoiceId;
    } else if (voiceMode === "custom") {
      finalVoiceId = customVoiceId;
      if (audioBlob && !customVoiceId) {
        setIsSubmitting(true);
        const vid = `custom_${derivedId || "npc_" + Date.now()}`;
        const result = await uploadVoiceClip(audioBlob, vid);
        setIsSubmitting(false);
        if (!result) { setFormError("Failed to upload voice clip."); return; }
        finalVoiceId = result.voice_id;
      }
    }

    const npc = createNpc({
      id: derivedId, name: trimmed, color, spriteId,
      personalityTraits: parsedTraits, coreDesires: parsedDesires,
      backstory: backstory.trim() || undefined,
      secrets: parsedSecrets, inventory,
      emotionalState: emotionalStateOverride,
      emotionalBaselines: baselinesMode !== "default" ? baselines : undefined,
      customVoiceId: finalVoiceId,
    });

    onAddToRoster(npc);
    clearForm();
  }

  const deletingPremade = confirmDeleteId
    ? customPremades.find((t) => t.id === confirmDeleteId)
    : null;

  const isPreview = !!previewTemplateId && !activeTemplateId;

  return (
    <div className="setup-screen">
      {/* ── Template Strip ─────────────────────────── */}
      <div className="template-strip">
        <div className="template-strip-label">Saved Characters</div>
        <div className="template-strip-scroll">
          {customPremades.map((template) => {
            const added = rosterIds.has(template.id);
            const isActive = activeTemplateId === template.id;
            const isPreviewing = previewTemplateId === template.id;
            return (
              <div
                key={template.id}
                className={`template-card${isActive ? " template-card-active" : ""}${isPreviewing ? " template-card-preview" : ""}${added ? " template-card-added" : ""}`}
                onMouseEnter={() => !added && handleTemplateHover(template)}
                onMouseLeave={handleTemplateLeave}
                onClick={() => !added && handleTemplateClick(template)}
              >
                <div className="template-card-manage">
                  <button
                    className="premade-manage-btn"
                    onClick={(e) => { e.stopPropagation(); handleTemplateClick(template); }}
                    title="Edit in builder"
                  >✎</button>
                  <button
                    className="premade-manage-btn premade-manage-delete"
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(template.id); }}
                    title="Delete"
                  >×</button>
                </div>
                <div className="template-card-sprite">
                  <div className="sprite-frame-mini">
                    <img
                      src={SPRITE_URL(template.spriteId || "Adam")}
                      alt=""
                      draggable={false}
                    />
                  </div>
                </div>
                <span className="template-card-name" style={{ color: added ? undefined : template.color }}>
                  {template.name}
                </span>
                <span className="template-card-traits">
                  {template.personalityTraits.slice(0, 2).map((t) => (
                    <span key={t} className="trait-chip">{t}</span>
                  ))}
                </span>
                {!added && !atCapacity && (
                  <button
                    className="template-quick-add"
                    onClick={(e) => { e.stopPropagation(); handleQuickAdd(template); }}
                    title="Add directly to roster"
                  >+</button>
                )}
                {added && <span className="premade-card-badge">Added</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Builder + Roster columns ───────────────── */}
      <div className="setup-columns">
        <div className="setup-left">
          <div className={`builder-section${isPreview ? " builder-preview" : ""}`}>
            <div className="builder-header">
              <span className="setup-section-title">
                {activeTemplateId ? "Edit Character" : "Create Character"}
              </span>
              <div className="builder-header-actions">
                <button className="btn btn-randomize-fields" onClick={handleRandomize}>Randomize</button>
                {activeTemplateId && (
                  <>
                    <button
                      className="btn btn-save-template"
                      onClick={handleSaveTemplate}
                      disabled={!hasTemplateChanges || isSubmitting}
                    >Save</button>
                    <button className="btn btn-randomize-fields" onClick={clearForm}>Clear</button>
                  </>
                )}
              </div>
            </div>

            {/* Sprite Picker */}
            <label className="builder-label">Sprite</label>
            <div className="sprite-picker">
              {SPRITE_NAMES.map((sname) => (
                <button
                  key={sname}
                  className={`sprite-option${spriteId === sname ? " selected" : ""}`}
                  onClick={() => setSpriteId(sname)}
                >
                  <div className="sprite-frame">
                    <img src={SPRITE_URL(sname)} alt="" draggable={false} />
                  </div>
                </button>
              ))}
            </div>

            {/* Name */}
            <label className="builder-label">Name</label>
            <input
              className="builder-input"
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setFormError(""); }}
              placeholder="e.g. Raven"
            />
            {isDuplicate && <div className="form-error">Name already taken</div>}

            {/* Color */}
            <label className="builder-label">Color</label>
            <div className="swatch-grid">
              {COLOR_SWATCHES.map((c) => (
                <button key={c} className={`swatch ${color === c ? "selected" : ""}`} style={{ backgroundColor: c }} onClick={() => setColor(c)} />
              ))}
            </div>

            {/* Traits */}
            <label className="builder-label">Personality Traits (comma-separated)</label>
            <input
              className="builder-input"
              type="text"
              value={traits}
              onChange={(e) => { setTraits(e.target.value); setFormError(""); }}
              placeholder="e.g. sarcastic, paranoid, clever"
            />

            {/* Desires */}
            <label className="builder-label">Core Desires (comma-separated)</label>
            <input
              className="builder-input"
              type="text"
              value={desires}
              onChange={(e) => { setDesires(e.target.value); setFormError(""); }}
              placeholder="e.g. uncover the truth, be left alone"
            />

            {/* Backstory, Secrets, Voice, Inventory */}
                <label className="builder-label">Backstory</label>
                <textarea
                  className="secrets-textarea"
                  value={backstory}
                  onChange={(e) => setBackstory(e.target.value)}
                  placeholder="A narrative paragraph describing who this character is..."
                  rows={4}
                />

                <label className="builder-label">Secrets (one per line)</label>
                <textarea
                  className="secrets-textarea"
                  value={secrets}
                  onChange={(e) => setSecrets(e.target.value)}
                  placeholder={"I once did something terrible...\nI secretly admire..."}
                  rows={3}
                />

                {/* Emotional Baselines */}
                <label className="builder-label">Emotional Baselines</label>
                <div className="voice-section">
                  <div className="voice-mode-tabs">
                    <button className={`voice-mode-tab ${baselinesMode === "default" ? "active" : ""}`} onClick={() => { setBaselinesMode("default"); setBaselines(undefined); }}>Default</button>
                    <button className={`voice-mode-tab ${baselinesMode === "derive" || (baselinesMode === "manual" && isDeriving) ? "active" : ""}`} onClick={() => handleDeriveBaselines()} disabled={isDeriving}>
                      {isDeriving ? "Deriving..." : "Derive from Traits"}
                    </button>
                    <button className={`voice-mode-tab ${baselinesMode === "manual" && !isDeriving ? "active" : ""}`} onClick={() => { setBaselinesMode("manual"); if (!baselines) setBaselines({ ...NpcStore.DEFAULT_EMOTION_BASELINES } as EmotionalState); }}>Manual</button>
                  </div>

                  {baselinesMode === "default" && (
                    <div className="voice-auto-hint">Emotions will decay toward global defaults after conversations.</div>
                  )}

                  {baselinesMode === "manual" && baselines && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "6px 0" }}>
                      {(["anger", "trust", "fear", "joy", "sadness", "curiosity", "guilt"] as const).map((key) => (
                        <div key={key} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ width: "60px", fontSize: "0.75em", opacity: 0.7, textTransform: "capitalize" }}>{key}</span>
                          <input
                            type="range"
                            min="0" max="1" step="0.05"
                            value={baselines[key] ?? NpcStore.DEFAULT_EMOTION_BASELINES[key] ?? 0.3}
                            onChange={(e) => setBaselines({ ...baselines, [key]: parseFloat(e.target.value) })}
                            style={{ flex: 1 }}
                          />
                          <span style={{ width: "28px", fontSize: "0.7em", opacity: 0.6, textAlign: "right" }}>
                            {(baselines[key] ?? NpcStore.DEFAULT_EMOTION_BASELINES[key] ?? 0.3).toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Voice */}
                <label className="builder-label">Voice</label>
                <div className="voice-section">
                  <div className="voice-mode-tabs">
                    <button className={`voice-mode-tab ${voiceMode === "auto" ? "active" : ""}`} onClick={() => { setVoiceMode("auto"); setSelectedVoiceId(undefined); }}>Auto</button>
                    <button className={`voice-mode-tab ${voiceMode === "select" ? "active" : ""}`} onClick={() => setVoiceMode("select")}>Choose Voice</button>
                    <button className={`voice-mode-tab ${voiceMode === "custom" ? "active" : ""}`} onClick={() => setVoiceMode("custom")}>Clone Voice</button>
                  </div>

                  {voiceMode === "auto" && (
                    <div className="voice-auto-hint">A voice will be assigned automatically when the simulation starts.</div>
                  )}

                  {voiceMode === "select" && (
                    <div className="voice-picker">
                      {availableVoices.map((v) => (
                        <div key={v.id} className={`voice-option ${selectedVoiceId === v.id ? "selected" : ""}`} onClick={() => setSelectedVoiceId(v.id)}>
                          <span className="voice-option-name">
                            {v.custom && <span className="voice-custom-badge">clone</span>}
                            {v.name}
                          </span>
                          <span className="voice-option-actions">
                            <button className="voice-preview-btn" onClick={(e) => { e.stopPropagation(); playPreview(v.id); }} title="Preview">
                              {previewingVoice === v.id ? "\u25A0" : "\u25B6"}
                            </button>
                            {v.custom && (
                              <button className="voice-delete-btn" onClick={(e) => { e.stopPropagation(); handleDeleteVoice(v.id); }} title="Delete">&times;</button>
                            )}
                          </span>
                        </div>
                      ))}
                      {availableVoices.length === 0 && <div className="voice-auto-hint">No voices available — is the TTS server running?</div>}
                    </div>
                  )}

                  {voiceMode === "custom" && (
                    <>
                      {audioUrl || hasExistingVoice ? (
                        <div className="voice-preview">
                          {audioUrl && <audio src={audioUrl} controls className="voice-audio" />}
                          {hasExistingVoice && !audioUrl && <span className="voice-existing-label">Custom voice set</span>}
                          <button className="btn voice-test-btn" disabled={isTesting} onClick={handleTestVoice}>{isTesting ? "Testing..." : "Test"}</button>
                          <button className="btn voice-clear-btn" onClick={clearVoice}>Remove</button>
                        </div>
                      ) : (
                        <>
                          <div className="voice-controls">
                            <button className={`btn voice-record-btn ${isRecording ? "recording" : ""}`} onClick={isRecording ? stopRecording : startRecording}>
                              {isRecording ? `Stop (${recordingTime}s)` : "Record"}
                            </button>
                            <label className="btn voice-upload-btn">
                              Upload
                              <input type="file" accept="audio/wav,audio/mpeg,audio/mp3,audio/m4a,audio/webm,.wav,.mp3,.m4a" onChange={handleFileUpload} hidden />
                            </label>
                          </div>
                          <div className="voice-yt-section">
                            <input type="text" className="voice-yt-url" value={ytUrl} onChange={(e) => setYtUrl(e.target.value)} placeholder="YouTube URL" />
                            <div className="voice-yt-times">
                              <div className="voice-yt-time-group">
                                <span className="voice-yt-time-heading">Start</span>
                                <div className="voice-yt-time-inputs">
                                  <label className="voice-yt-time-label">
                                    <input type="number" className="voice-yt-time" value={ytStartMin} onChange={(e) => setYtStartMin(e.target.value)} min="0" step="1" />
                                    <span className="voice-yt-time-unit">m</span>
                                  </label>
                                  <label className="voice-yt-time-label">
                                    <input type="number" className="voice-yt-time" value={ytStartSec} onChange={(e) => setYtStartSec(e.target.value)} min="0" max="59" step="1" />
                                    <span className="voice-yt-time-unit">s</span>
                                  </label>
                                </div>
                              </div>
                              <div className="voice-yt-time-group">
                                <span className="voice-yt-time-heading">End</span>
                                <div className="voice-yt-time-inputs">
                                  <label className="voice-yt-time-label">
                                    <input type="number" className="voice-yt-time" value={ytEndMin} onChange={(e) => setYtEndMin(e.target.value)} min="0" step="1" />
                                    <span className="voice-yt-time-unit">m</span>
                                  </label>
                                  <label className="voice-yt-time-label">
                                    <input type="number" className="voice-yt-time" value={ytEndSec} onChange={(e) => setYtEndSec(e.target.value)} min="0" max="59" step="1" />
                                    <span className="voice-yt-time-unit">s</span>
                                  </label>
                                </div>
                              </div>
                              <button className="btn voice-yt-extract-btn" onClick={handleYoutubeExtract} disabled={ytLoading}>
                                {ytLoading ? "Extracting..." : "Extract"}
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>

                {/* Inventory */}
                <label className="builder-label">
                  Starting Inventory
                  <span className="creator-inv-count">{inventory.length}/8</span>
                </label>
                {inventory.length > 0 && (
                  <div className="creator-inv-current">
                    {inventory.map((item) => (
                      <span key={item.id} className="creator-inv-item" style={{ borderColor: CATEGORY_COLORS[item.category] }}>
                        {item.emoji} {item.label}
                        <button className="creator-inv-remove" onClick={() => removeItem(item.id)} title="Remove">x</button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="creator-inv-picker">
                  {itemsByCategory.map((group) => (
                    <div key={group.category} className="creator-inv-group">
                      <span className="creator-inv-cat-label" style={{ color: CATEGORY_COLORS[group.category] }}>{group.category}</span>
                      {group.items.map((item) => (
                        <button key={item.label} className="creator-inv-add-btn" disabled={inventory.length >= 8} onClick={() => addItem(item)} title={`Add ${item.label}`}>
                          {item.emoji} {item.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>

            {formError && <div className="form-error">{formError}</div>}

            <button className="btn-spawn" onClick={handleSubmit} disabled={isSubmitting || atCapacity}>
              {isSubmitting ? "Uploading voice..." : atCapacity ? "Roster Full" : "Add to Roster"}
            </button>
          </div>

          {/* Settings Accordion */}
          <div className="setup-section setup-settings-section">
            <button className="setup-settings-toggle" onClick={() => setSettingsOpen((p) => !p)}>
              <span className="setup-section-title">Settings</span>
              <span className="setup-settings-summary">
                {{ ollama: "Ollama", groq: "Groq", gemini: "Gemini" }[llmConfig.provider]} · {language} · {ttsEngine === "chatterbox" ? "Chatterbox" : "Kokoro"} · {MAPS.find(m => m.url === mapUrl)?.label ?? "Custom"}
              </span>
              <span className={`setup-settings-chevron ${settingsOpen ? "open" : ""}`}>›</span>
            </button>

            {settingsOpen && (
              <div className="setup-settings-body">
                <div className="setup-setting-row">
                  <span className="setup-setting-label">Language</span>
                  <select className="setup-language-select" value={language} onChange={(e) => onLanguageChange(e.target.value)}>
                    {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                  </select>
                </div>

                <div className="setup-setting-group">
                  <span className="setup-setting-label">Map</span>
                  <div className="setup-tts-engine-options">
                    {MAPS.map((m) => (
                      <button key={m.url} className={`tts-engine-btn ${mapUrl === m.url ? "active" : ""}`} onClick={() => onMapChange(m.url)}>{m.label}</button>
                    ))}
                  </div>
                  <span className="tts-engine-hint">{MAPS.find(m => m.url === mapUrl)?.description ?? ""}</span>
                </div>

                <div className="setup-setting-group">
                  <span className="setup-setting-label">LLM Provider</span>
                  <div className="setup-tts-engine-options">
                    <button className={`tts-engine-btn ${llmConfig.provider === "ollama" ? "active" : ""}`} onClick={() => onLlmConfigChange({ provider: "ollama" as LlmProvider })}>Local (Ollama)</button>
                    <button className={`tts-engine-btn ${llmConfig.provider === "groq" ? "active" : ""}`} onClick={() => onLlmConfigChange({ provider: "groq" as LlmProvider })}>Cloud (Groq)</button>
                    <button className={`tts-engine-btn ${llmConfig.provider === "gemini" ? "active" : ""}`} onClick={() => onLlmConfigChange({ provider: "gemini" as LlmProvider })}>Cloud (Gemini)</button>
                  </div>
                  {llmConfig.provider === "ollama" && (
                    <div className="llm-detail">
                      <input className="llm-input" type="text" value={llmConfig.ollamaModel} onChange={(e) => onLlmConfigChange({ ollamaModel: e.target.value })} placeholder="Model name" />
                    </div>
                  )}
                  {llmConfig.provider === "groq" && (
                    <div className="llm-detail">
                      <input className="llm-input" type="password" value={llmConfig.groqApiKey} onChange={(e) => onLlmConfigChange({ groqApiKey: e.target.value })} placeholder="Groq API key" />
                      <select className="llm-select" value={llmConfig.groqModel} onChange={(e) => onLlmConfigChange({ groqModel: e.target.value })}>
                        {GROQ_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </select>
                    </div>
                  )}
                  {llmConfig.provider === "gemini" && (
                    <div className="llm-detail">
                      <input className="llm-input" type="password" value={llmConfig.geminiApiKey} onChange={(e) => onLlmConfigChange({ geminiApiKey: e.target.value })} placeholder="Gemini API key" />
                      <select className="llm-select" value={llmConfig.geminiModel} onChange={(e) => onLlmConfigChange({ geminiModel: e.target.value })}>
                        {GEMINI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                <div className="setup-setting-group">
                  <span className="setup-setting-label">TTS Engine</span>
                  <div className="setup-tts-engine-options">
                    <button className={`tts-engine-btn ${ttsEngine === "chatterbox" ? "active" : ""} ${!isEnglish ? "disabled" : ""}`} onClick={() => isEnglish && onTtsEngineChange("chatterbox")} disabled={!isEnglish}>Chatterbox Turbo</button>
                    <button className={`tts-engine-btn ${ttsEngine === "kokoro" ? "active" : ""}`} onClick={() => onTtsEngineChange("kokoro")}>Kokoro</button>
                  </div>
                  {!isEnglish && <span className="tts-engine-hint">Chatterbox Turbo only supports English</span>}
                  <div className="tts-test-area">
                    <input className="tts-test-input-inline" type="text" placeholder="Type a phrase to test..." value={testPhrase} onChange={(e) => setTestPhrase(e.target.value)} />
                    <button
                      className="btn tts-test-btn"
                      disabled={!testPhrase.trim() || testPlaying}
                      onClick={() => {
                        setTestPlaying(true);
                        onTestTts(testPhrase.trim(), ttsEngine);
                        if (testTimeout.current) clearTimeout(testTimeout.current);
                        testTimeout.current = window.setTimeout(() => setTestPlaying(false), 5000);
                      }}
                    >{testPlaying ? "Playing..." : "Test"}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Roster ─────────────────────────────────── */}
        <div className="setup-right">
          <div className="roster-section">
            <div className="roster-header">
              <span className="roster-label">Roster</span>
              <span className="roster-count">{roster.length}/{MAX_ROSTER}</span>
            </div>

            {roster.length === 0 ? (
              <div className="roster-empty">
                <span className="roster-empty-icon">?</span>
                <span className="roster-empty-text">No characters yet — pick a template, randomize, or build your own</span>
              </div>
            ) : (
              <div className="roster-grid">
                {roster.map((npc) => {
                  const isSaved = savedPremadeIds.has(npc.id);
                  return (
                    <div key={npc.id} className="roster-card">
                      <button className="roster-card-remove" onClick={() => onRemoveFromRoster(npc.id)} title="Remove">×</button>
                      <button className={`roster-card-save ${isSaved ? "saved" : ""}`} onClick={() => handleSaveAsPremade(npc)} title={isSaved ? "Saved as premade" : "Save as premade"}>
                        {isSaved ? "★" : "☆"}
                      </button>
                      {npc.customVoiceId && <span className="roster-card-voice" title="Custom voice">🎙</span>}
                      <div className="roster-card-sprite">
                        <div className="sprite-frame-mini">
                          <img src={SPRITE_URL(npc.spriteId || "Adam")} alt="" draggable={false} />
                        </div>
                      </div>
                      <div className="roster-card-name" style={{ color: npc.color }}>{npc.name}</div>
                      <div className="roster-card-traits">
                        {npc.personalityTraits.slice(0, 2).map((t) => <span key={t} className="trait-chip">{t}</span>)}
                      </div>
                      {npc.coreDesires[0] && <div className="roster-card-desire">{npc.coreDesires[0]}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Start Bar ──────────────────────────────── */}
      <div className="setup-start-bar">
        <div className="setup-start-bar-inner">
          {onTestMap && <button className="btn btn-test-map" onClick={onTestMap}>Test Map</button>}
          <button className="btn btn-start-sim" disabled={roster.length < 2} onClick={onStartSimulation}>
            {roster.length < 2 ? `Add ${2 - roster.length} more character${2 - roster.length > 1 ? "s" : ""}` : "Start Simulation"}
          </button>
        </div>
      </div>

      {/* ── Delete Confirmation Modal ──────────────── */}
      {confirmDeleteId && deletingPremade && (
        <div className="modal-overlay" onClick={() => setConfirmDeleteId(null)}>
          <div className="modal-content confirm-delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Premade</h3>
            <p>Are you sure you want to delete <strong>{deletingPremade.name}</strong>? This cannot be undone.</p>
            <div className="confirm-delete-actions">
              <button className="btn" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleConfirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
