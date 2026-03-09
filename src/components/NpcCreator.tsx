import { useState, useRef, useEffect } from "react";
import { createNpc, randomizeFields, AVATAR_OPTIONS, COLOR_SWATCHES, RANDOM_ITEMS } from "../npcs";
import type { NPC, InventoryItem, ItemCategory, EmotionalState } from "../types";
import { ITEM_LIFETIME_BY_CATEGORY } from "../types";
import { uploadVoiceClip, fetchVoices, getVoicePreviewUrl, deleteVoice, youtubeVoiceClip } from "../tts-service";
import type { VoiceInfo } from "../tts-service";

interface NpcCreatorProps {
  onClose: () => void;
  onCreateNpc: (npc: NPC) => void;
  existingIds: string[];
  initialNpc?: NPC;
  title?: string;
  submitLabel?: string;
}

const CATEGORY_ORDER: ItemCategory[] = ["food", "herb", "fish", "trinket", "craft", "book"];

const CATEGORY_COLORS: Record<string, string> = {
  food: "#e0a84c",
  herb: "#5cb87a",
  fish: "#6ba4d4",
  trinket: "#a876c4",
  book: "#9e8878",
  craft: "#e0c84c",
};

export function NpcCreator({
  onClose,
  onCreateNpc,
  existingIds,
  initialNpc,
  title,
  submitLabel,
}: NpcCreatorProps) {
  const [name, setName] = useState(initialNpc?.name ?? "");
  const [avatar, setAvatar] = useState(initialNpc?.avatar ?? "😀");
  const [color, setColor] = useState(initialNpc?.color ?? "#4dd0e1");
  const [traits, setTraits] = useState(
    initialNpc?.personalityTraits.join(", ") ?? ""
  );
  const [desires, setDesires] = useState(
    initialNpc?.coreDesires.join(", ") ?? ""
  );
  const [secrets, setSecrets] = useState(
    initialNpc?.secrets.join("\n") ?? ""
  );
  const [inventory, setInventory] = useState<InventoryItem[]>(
    initialNpc?.inventory ?? []
  );
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Preserve emotional state from the initial NPC when editing
  const [emotionalStateOverride] = useState<Partial<EmotionalState> | undefined>(
    initialNpc?.emotionalState
  );

  // ── Voice cloning state ──────────────────────────
  const [customVoiceId, setCustomVoiceId] = useState<string | undefined>(
    initialNpc?.customVoiceId
  );
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isTesting, setIsTesting] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const testAudioCtxRef = useRef<AudioContext | null>(null);

  // ── Voice selector state ────────────────────────
  const [availableVoices, setAvailableVoices] = useState<VoiceInfo[]>([]);
  const [voiceMode, setVoiceMode] = useState<"auto" | "select" | "custom">(
    initialNpc?.customVoiceId
      ? initialNpc.customVoiceId.startsWith("custom_") ? "custom" : "select"
      : "auto"
  );
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | undefined>(
    initialNpc?.customVoiceId && !initialNpc.customVoiceId.startsWith("custom_")
      ? initialNpc.customVoiceId
      : undefined
  );
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // ── YouTube extraction state ───────────────────
  const [ytUrl, setYtUrl] = useState("");
  const [ytStart, setYtStart] = useState("0");
  const [ytEnd, setYtEnd] = useState("30");
  const [ytLoading, setYtLoading] = useState(false);

  // If editing an NPC with a custom voice, show its existing clip
  const hasExistingVoice = voiceMode === "custom" && !!customVoiceId && !audioBlob;

  // Fetch available voices on mount
  useEffect(() => {
    fetchVoices().then(setAvailableVoices);
  }, []);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (timerRef.current) clearInterval(timerRef.current);
      if (testAudioCtxRef.current) testAudioCtxRef.current.close();
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
    };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const derivedId = name.trim().toLowerCase().replace(/\s+/g, "-");
  const isDuplicate =
    derivedId !== "" &&
    derivedId !== initialNpc?.id &&
    existingIds.includes(derivedId);

  function handleRandomize() {
    const r = randomizeFields(existingIds);
    setName(r.name);
    setAvatar(r.avatar);
    setColor(r.color);
    setTraits(r.traits.join(", "));
    setDesires(r.desires.join(", "));
    setSecrets(r.secrets.join("\n"));
    setInventory(r.inventory);
    setError("");
  }

  function addItem(item: typeof RANDOM_ITEMS[number]) {
    if (inventory.length >= 8) return;
    setInventory((prev) => [
      ...prev,
      {
        id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        label: item.label,
        category: item.category,
        emoji: item.emoji,
        acquiredAt: Date.now(),
        lifetimeMs: ITEM_LIFETIME_BY_CATEGORY[item.category],
      },
    ]);
  }

  function removeItem(itemId: string) {
    setInventory((prev) => prev.filter((i) => i.id !== itemId));
  }

  // ── Voice recording / upload helpers ───────────
  async function convertToWav(blob: Blob): Promise<Blob> {
    const audioCtx = new AudioContext({ sampleRate: 24000 });
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    const length = Math.min(audioBuffer.length, 24000 * 30); // cap at 30s
    const wavBuffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(wavBuffer);

    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++)
        view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + length * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);   // PCM
    view.setUint16(22, 1, true);   // mono
    view.setUint32(24, 24000, true);
    view.setUint32(28, 48000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
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

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const rawBlob = new Blob(chunksRef.current, { type: recorder.mimeType });
        stream.getTracks().forEach((t) => t.stop());
        try {
          const wavBlob = await convertToWav(rawBlob);
          setAudioBlob(wavBlob);
          if (audioUrl) URL.revokeObjectURL(audioUrl);
          setAudioUrl(URL.createObjectURL(wavBlob));
          setCustomVoiceId(undefined); // needs re-upload
        } catch (err) {
          setError("Failed to process recording");
          console.warn("[voice] conversion error:", err);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = window.setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);

      // Auto-stop after 30 seconds
      setTimeout(() => stopRecording(), 30000);
    } catch {
      setError("Microphone access denied");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("audio/") && !file.name.match(/\.(wav|mp3|m4a|ogg|webm)$/i)) {
      setError("Please upload an audio file");
      return;
    }

    try {
      const wavBlob = await convertToWav(file);
      setAudioBlob(wavBlob);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(URL.createObjectURL(wavBlob));
      setCustomVoiceId(undefined); // needs upload
      setError("");
    } catch (err) {
      setError("Could not process audio file");
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
    if (!ytUrl.trim()) {
      setError("Enter a YouTube URL");
      return;
    }
    const start = parseFloat(ytStart) || 0;
    const end = parseFloat(ytEnd) || 30;
    if (end <= start) {
      setError("End time must be after start time");
      return;
    }

    setYtLoading(true);
    setError("");
    const currentId = name.trim().toLowerCase().replace(/\s+/g, "-");
    const voiceId = `custom_${currentId || "yt_" + Date.now()}`;
    const result = await youtubeVoiceClip(ytUrl.trim(), start, end, voiceId);
    setYtLoading(false);

    if (!result) {
      setError("Failed to extract audio from YouTube. Check the URL and time range.");
      return;
    }

    setCustomVoiceId(result.voice_id);
    setAudioBlob(null); // no local blob — it's already on the server
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    // Fetch the extracted clip from the server so the audio player shows up
    try {
      const clipRes = await fetch(`http://localhost:8787/voice-clip/${result.voice_id}`);
      if (clipRes.ok) {
        const blob = await clipRes.blob();
        setAudioUrl(URL.createObjectURL(blob));
      }
    } catch { /* preview will still work via Test button */ }
  }

  async function playPreview(voiceId: string) {
    // Stop any current preview
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    if (previewingVoice === voiceId) {
      setPreviewingVoice(null);
      return;
    }

    setPreviewingVoice(voiceId);
    try {
      // Fetch with a long timeout — first request triggers Chatterbox generation
      const res = await fetch(getVoicePreviewUrl(voiceId), {
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => {
        setPreviewingVoice(null);
        previewAudioRef.current = null;
        URL.revokeObjectURL(url);
      };
      audio.play();
    } catch {
      setPreviewingVoice(null);
      setError("Preview not available — is the TTS server running?");
    }
  }

  async function handleDeleteVoice(voiceId: string) {
    const ok = await deleteVoice(voiceId);
    if (ok) {
      setAvailableVoices((prev) => prev.filter((v) => v.id !== voiceId));
      if (selectedVoiceId === voiceId) setSelectedVoiceId(undefined);
    } else {
      setError("Failed to delete voice");
    }
  }

  async function handleTestVoice() {
    setIsTesting(true);
    const currentId = name.trim().toLowerCase().replace(/\s+/g, "-");

    // Upload if not yet uploaded
    let voiceId = customVoiceId;
    if (!voiceId && audioBlob) {
      const tempId = `custom_${currentId || "test_" + Date.now()}`;
      const result = await uploadVoiceClip(audioBlob, tempId);
      if (!result) {
        setError("Could not upload voice for testing. Is the TTS server running?");
        setIsTesting(false);
        return;
      }
      voiceId = result.voice_id;
      setCustomVoiceId(voiceId);
    }

    if (!voiceId) {
      setIsTesting(false);
      return;
    }

    try {
      const res = await fetch("http://localhost:8787/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Hello there! This is what I sound like. Nice to meet you.",
          voice: voiceId,
          speed: 1.0,
          engine: "chatterbox",
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const wavBytes = await res.arrayBuffer();
        const ctx = new AudioContext({ sampleRate: 24000 });
        testAudioCtxRef.current = ctx;
        const audioBuffer = await ctx.decodeAudioData(wavBytes);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.onended = () => {
          setIsTesting(false);
          ctx.close();
          testAudioCtxRef.current = null;
        };
        source.start();
      } else {
        setError("Voice test failed");
        setIsTesting(false);
      }
    } catch {
      setError("TTS server not available for testing");
      setIsTesting(false);
    }
  }

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    if (isDuplicate) {
      setError("An NPC with that name already exists");
      return;
    }

    const parsedTraits = traits
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const parsedDesires = desires
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);

    if (parsedTraits.length === 0) {
      setError("Add at least one personality trait");
      return;
    }
    if (parsedDesires.length === 0) {
      setError("Add at least one core desire");
      return;
    }

    const parsedSecrets = secrets
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    // Determine final voice ID based on mode
    let finalVoiceId: string | undefined;
    if (voiceMode === "select" && selectedVoiceId) {
      finalVoiceId = selectedVoiceId;
    } else if (voiceMode === "custom") {
      finalVoiceId = customVoiceId;
      if (audioBlob && !customVoiceId) {
        setIsSubmitting(true);
        const voiceId = `custom_${derivedId || "npc_" + Date.now()}`;
        const result = await uploadVoiceClip(audioBlob, voiceId);
        setIsSubmitting(false);
        if (!result) {
          setError("Failed to upload voice clip. Is the TTS server running?");
          return;
        }
        finalVoiceId = result.voice_id;
      }
    }

    const npc = createNpc({
      id: derivedId,
      name: trimmed,
      avatar,
      color,
      personalityTraits: parsedTraits,
      coreDesires: parsedDesires,
      secrets: parsedSecrets,
      inventory,
      emotionalState: emotionalStateOverride,
      customVoiceId: finalVoiceId,
    });

    onCreateNpc(npc);
    onClose();
  }

  // Group available items by category
  const itemsByCategory = CATEGORY_ORDER
    .map((cat) => ({
      category: cat,
      items: RANDOM_ITEMS.filter((i) => i.category === cat),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header-row">
          <h3>{title ?? "Create NPC"}</h3>
          <button className="btn btn-randomize-fields" onClick={handleRandomize}>
            Randomize
          </button>
        </div>

        <label>Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          placeholder="e.g. Raven"
          autoFocus
        />
        {isDuplicate && (
          <div className="form-error">Name already taken</div>
        )}

        <label>Avatar</label>
        <div className="avatar-grid">
          {AVATAR_OPTIONS.map((emoji) => (
            <button
              key={emoji}
              className={`avatar-option ${avatar === emoji ? "selected" : ""}`}
              onClick={() => setAvatar(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>

        <label>Color</label>
        <div className="swatch-grid">
          {COLOR_SWATCHES.map((c) => (
            <button
              key={c}
              className={`swatch ${color === c ? "selected" : ""}`}
              style={{ backgroundColor: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>

        <label>Personality Traits (comma-separated)</label>
        <input
          type="text"
          value={traits}
          onChange={(e) => {
            setTraits(e.target.value);
            setError("");
          }}
          placeholder="e.g. sarcastic, paranoid, clever"
        />

        <label>Core Desires (comma-separated)</label>
        <input
          type="text"
          value={desires}
          onChange={(e) => {
            setDesires(e.target.value);
            setError("");
          }}
          placeholder="e.g. uncover the truth, be left alone"
        />

        <label>Secrets (one per line, optional)</label>
        <textarea
          value={secrets}
          onChange={(e) => setSecrets(e.target.value)}
          placeholder={"I once did something terrible...\nI secretly admire..."}
          rows={3}
          className="secrets-textarea"
        />

        <label>Voice</label>
        <div className="voice-section">
          <div className="voice-mode-tabs">
            <button
              className={`voice-mode-tab ${voiceMode === "auto" ? "active" : ""}`}
              onClick={() => { setVoiceMode("auto"); setSelectedVoiceId(undefined); }}
            >
              Auto
            </button>
            <button
              className={`voice-mode-tab ${voiceMode === "select" ? "active" : ""}`}
              onClick={() => setVoiceMode("select")}
            >
              Choose Voice
            </button>
            <button
              className={`voice-mode-tab ${voiceMode === "custom" ? "active" : ""}`}
              onClick={() => setVoiceMode("custom")}
            >
              Clone Voice
            </button>
          </div>

          {voiceMode === "auto" && (
            <div className="voice-auto-hint">
              A voice will be assigned automatically when the simulation starts.
            </div>
          )}

          {voiceMode === "select" && (
            <div className="voice-picker">
              {availableVoices.map((v) => (
                <div
                  key={v.id}
                  className={`voice-option ${selectedVoiceId === v.id ? "selected" : ""}`}
                  onClick={() => setSelectedVoiceId(v.id)}
                >
                  <span className="voice-option-name">
                    {v.custom && <span className="voice-custom-badge">clone</span>}
                    {v.name}
                  </span>
                  <span className="voice-option-actions">
                    <button
                      className="voice-preview-btn"
                      onClick={(e) => { e.stopPropagation(); playPreview(v.id); }}
                      title="Preview voice"
                    >
                      {previewingVoice === v.id ? "\u25A0" : "\u25B6"}
                    </button>
                    {v.custom && (
                      <button
                        className="voice-delete-btn"
                        onClick={(e) => { e.stopPropagation(); handleDeleteVoice(v.id); }}
                        title="Delete voice"
                      >
                        &times;
                      </button>
                    )}
                  </span>
                </div>
              ))}
              {availableVoices.length === 0 && (
                <div className="voice-auto-hint">
                  No voices available — is the TTS server running?
                </div>
              )}
            </div>
          )}

          {voiceMode === "custom" && (
            <>
              {audioUrl || hasExistingVoice ? (
                <div className="voice-preview">
                  {audioUrl && (
                    <audio src={audioUrl} controls className="voice-audio" />
                  )}
                  {hasExistingVoice && !audioUrl && (
                    <span className="voice-existing-label">Custom voice set</span>
                  )}
                  <button
                    className="btn voice-test-btn"
                    disabled={isTesting}
                    onClick={handleTestVoice}
                  >
                    {isTesting ? "Testing..." : "Test"}
                  </button>
                  <button className="btn voice-clear-btn" onClick={clearVoice}>
                    Remove
                  </button>
                </div>
              ) : (
                <>
                <div className="voice-controls">
                  <button
                    className={`btn voice-record-btn ${isRecording ? "recording" : ""}`}
                    onClick={isRecording ? stopRecording : startRecording}
                  >
                    {isRecording ? `Stop (${recordingTime}s)` : "Record"}
                  </button>
                  <label className="btn voice-upload-btn">
                    Upload
                    <input
                      type="file"
                      accept="audio/wav,audio/mpeg,audio/mp3,audio/m4a,audio/webm,.wav,.mp3,.m4a"
                      onChange={handleFileUpload}
                      hidden
                    />
                  </label>
                </div>
                <div className="voice-yt-section">
                  <input
                    type="text"
                    className="voice-yt-url"
                    value={ytUrl}
                    onChange={(e) => setYtUrl(e.target.value)}
                    placeholder="YouTube URL"
                  />
                  <div className="voice-yt-times">
                    <label className="voice-yt-time-label">
                      Start (s)
                      <input
                        type="number"
                        className="voice-yt-time"
                        value={ytStart}
                        onChange={(e) => setYtStart(e.target.value)}
                        min="0"
                        step="0.1"
                      />
                    </label>
                    <label className="voice-yt-time-label">
                      End (s)
                      <input
                        type="number"
                        className="voice-yt-time"
                        value={ytEnd}
                        onChange={(e) => setYtEnd(e.target.value)}
                        min="0"
                        step="0.1"
                      />
                    </label>
                    <button
                      className="btn voice-yt-extract-btn"
                      onClick={handleYoutubeExtract}
                      disabled={ytLoading}
                    >
                      {ytLoading ? "Extracting..." : "Extract"}
                    </button>
                  </div>
                </div>
                </>
              )}
            </>
          )}
        </div>

        <label>
          Starting Inventory
          <span className="creator-inv-count">{inventory.length}/8</span>
        </label>
        {inventory.length > 0 && (
          <div className="creator-inv-current">
            {inventory.map((item) => (
              <span
                key={item.id}
                className="creator-inv-item"
                style={{ borderColor: CATEGORY_COLORS[item.category] }}
              >
                {item.emoji} {item.label}
                <button
                  className="creator-inv-remove"
                  onClick={() => removeItem(item.id)}
                  title="Remove"
                >
                  x
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="creator-inv-picker">
          {itemsByCategory.map((group) => (
            <div key={group.category} className="creator-inv-group">
              <span
                className="creator-inv-cat-label"
                style={{ color: CATEGORY_COLORS[group.category] }}
              >
                {group.category}
              </span>
              {group.items.map((item) => (
                <button
                  key={item.label}
                  className="creator-inv-add-btn"
                  disabled={inventory.length >= 8}
                  onClick={() => addItem(item)}
                  title={`Add ${item.label}`}
                >
                  {item.emoji} {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        {error && <div className="form-error">{error}</div>}

        <button className="btn-spawn" onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? "Uploading voice..." : submitLabel ?? "Spawn"}
        </button>
      </div>
    </div>
  );
}
