import { useState, useRef } from "react";
import { randomizeNpc } from "../npcs";
import { NpcCreator } from "./NpcCreator";
import type { NPC } from "../types";
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
import { GROQ_MODELS } from "../llm-config";

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

interface SetupScreenProps {
  roster: NPC[];
  language: string;
  ttsEngine: TTSEngine;
  llmConfig: LlmConfig;
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
  onLlmConfigChange,
  onTestTts,
  onStartSimulation,
  onTestMap,
}: SetupScreenProps) {
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [customPremades, setCustomPremades] = useState<PremadeTemplate[]>(
    () => {
      ensurePremadeSeeded();
      return loadCustomPremades();
    }
  );
  const [editingPremade, setEditingPremade] = useState<PremadeTemplate | null>(
    null
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [testPhrase, setTestPhrase] = useState("");
  const [testPlaying, setTestPlaying] = useState(false);
  const testTimeout = useRef<number | null>(null);

  // Clean up test timer on unmount
  useEffect(() => {
    return () => { if (testTimeout.current) clearTimeout(testTimeout.current); };
  }, []);

  const rosterIds = new Set(roster.map((n) => n.id));
  const atCapacity = roster.length >= MAX_ROSTER;
  const savedPremadeIds = new Set(customPremades.map((t) => t.id));

  function refreshPremades() {
    setCustomPremades(loadCustomPremades());
  }

  function handleSaveAsPremade(npc: NPC) {
    saveCustomPremade(npcToPremadeTemplate(npc));
    refreshPremades();
  }

  function handleConfirmDelete() {
    if (confirmDeleteId) {
      deleteCustomPremade(confirmDeleteId);
      refreshPremades();
      setConfirmDeleteId(null);
    }
  }

  function handleEditSubmit(npc: NPC) {
    if (editingPremade && editingPremade.id !== npc.id) {
      deleteCustomPremade(editingPremade.id);
    }
    saveCustomPremade(npcToPremadeTemplate(npc));
    refreshPremades();
    setEditingPremade(null);
  }

  const deletingPremade = confirmDeleteId
    ? customPremades.find((t) => t.id === confirmDeleteId)
    : null;

  // Collect all IDs for duplicate checking when editing
  const allPremadeIds = [
    ...customPremades.map((t) => t.id),
    ...roster.map((n) => n.id),
  ];

  return (
    <div className="setup-screen">
      <div className="setup-header">
        <h1 className="setup-title">NPC Playground</h1>
        <p className="setup-subtitle">Assemble your cast</p>
      </div>

      <div className="setup-actions">
        <button
          className="btn btn-premade"
          disabled={atCapacity}
          onClick={() => setGalleryOpen((p) => !p)}
        >
          {galleryOpen ? "− Premade" : "+ Premade"}
        </button>
        <button
          className="btn btn-randomize"
          disabled={atCapacity}
          onClick={() => {
            const npc = randomizeNpc(roster.map((n) => n.id));
            onAddToRoster(npc);
          }}
        >
          Randomize
        </button>
        <button
          className="btn btn-create"
          disabled={atCapacity}
          onClick={() => setCreatorOpen(true)}
        >
          + Custom
        </button>
      </div>

      {galleryOpen && (
        <div className="premade-gallery">
          <div className="premade-grid">
            {customPremades.map((template) => {
              const npc = premadeTemplateToNpc(template);
              const added = rosterIds.has(npc.id);
              return (
                <div
                  key={`custom-${template.id}`}
                  className={`premade-card premade-card-custom ${added ? "premade-card-added" : ""} ${(added || atCapacity) ? "premade-card-disabled" : ""}`}
                  onClick={() => {
                    if (!added && !atCapacity) onAddToRoster(npc);
                  }}
                >
                  <div className="premade-card-manage">
                    <button
                      className="premade-manage-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingPremade(template);
                      }}
                      title="Edit"
                    >
                      ✎
                    </button>
                    <button
                      className="premade-manage-btn premade-manage-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(template.id);
                      }}
                      title="Delete"
                    >
                      ×
                    </button>
                  </div>
                  <span className="premade-card-avatar">{npc.avatar}</span>
                  <span
                    className="premade-card-name"
                    style={{ color: added ? undefined : npc.color }}
                  >
                    {npc.name}
                  </span>
                  <span className="premade-card-traits">
                    {npc.personalityTraits.slice(0, 2).map((t) => (
                      <span key={t} className="trait-chip">{t}</span>
                    ))}
                  </span>
                  {npc.coreDesires[0] && (
                    <span className="premade-card-desire">
                      {npc.coreDesires[0]}
                    </span>
                  )}
                  {added && <span className="premade-card-badge">Added</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="setup-language">
        <label className="setup-language-label" htmlFor="language-select">
          Language
        </label>
        <select
          id="language-select"
          className="setup-language-select"
          value={language}
          onChange={(e) => onLanguageChange(e.target.value)}
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div className="setup-llm-provider">
        <span className="setup-tts-engine-label">LLM Provider</span>
        <div className="setup-tts-engine-options">
          <button
            className={`tts-engine-btn ${llmConfig.provider === "ollama" ? "active" : ""}`}
            onClick={() => onLlmConfigChange({ provider: "ollama" as LlmProvider })}
          >
            Local (Ollama)
          </button>
          <button
            className={`tts-engine-btn ${llmConfig.provider === "groq" ? "active" : ""}`}
            onClick={() => onLlmConfigChange({ provider: "groq" as LlmProvider })}
          >
            Cloud (Groq)
          </button>
        </div>
        {llmConfig.provider === "ollama" && (
          <div className="llm-detail">
            <input
              className="llm-input"
              type="text"
              value={llmConfig.ollamaModel}
              onChange={(e) => onLlmConfigChange({ ollamaModel: e.target.value })}
              placeholder="Model name"
            />
          </div>
        )}
        {llmConfig.provider === "groq" && (
          <div className="llm-detail">
            <input
              className="llm-input"
              type="password"
              value={llmConfig.groqApiKey}
              onChange={(e) => onLlmConfigChange({ groqApiKey: e.target.value })}
              placeholder="Groq API key"
            />
            <select
              className="llm-select"
              value={llmConfig.groqModel}
              onChange={(e) => onLlmConfigChange({ groqModel: e.target.value })}
            >
              {GROQ_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {(() => {
        const lang = language.toLowerCase().trim();
        const isEnglish = lang === "english" || lang === "british english";
        return (
          <div className="setup-tts-engine">
            <span className="setup-tts-engine-label">TTS Engine</span>
            <div className="setup-tts-engine-options">
              <button
                className={`tts-engine-btn ${ttsEngine === "chatterbox" ? "active" : ""} ${!isEnglish ? "disabled" : ""}`}
                onClick={() => isEnglish && onTtsEngineChange("chatterbox")}
                disabled={!isEnglish}
              >
                Chatterbox Turbo
              </button>
              <button
                className={`tts-engine-btn ${ttsEngine === "kokoro" ? "active" : ""}`}
                onClick={() => onTtsEngineChange("kokoro")}
              >
                Kokoro
              </button>
            </div>
            {!isEnglish && (
              <span className="tts-engine-hint">
                Chatterbox Turbo only supports English
              </span>
            )}
            <div className="tts-test-area">
              <textarea
                className="tts-test-input"
                placeholder="Type a phrase to test..."
                value={testPhrase}
                onChange={(e) => setTestPhrase(e.target.value)}
              />
              <button
                className="btn tts-test-btn"
                disabled={!testPhrase.trim() || testPlaying}
                onClick={() => {
                  setTestPlaying(true);
                  onTestTts(testPhrase.trim(), ttsEngine);
                  if (testTimeout.current) clearTimeout(testTimeout.current);
                  testTimeout.current = window.setTimeout(() => setTestPlaying(false), 5000);
                }}
              >
                {testPlaying ? "Playing..." : "Test"}
              </button>
            </div>
          </div>
        );
      })()}

      <div className="setup-start-area">
        <button
          className="btn btn-start-sim"
          disabled={roster.length < 2}
          onClick={onStartSimulation}
        >
          Start Simulation
        </button>
        {onTestMap && (
          <button
            className="btn btn-test-map"
            onClick={onTestMap}
          >
            Test Map
          </button>
        )}
        {roster.length < 2 && (
          <p className="setup-start-hint">Add at least 2 characters</p>
        )}
      </div>

      <div className="roster-section">
        <div className="roster-header">
          <span className="roster-label">Roster</span>
          <span className="roster-count">
            {roster.length}/{MAX_ROSTER}
          </span>
        </div>

        {roster.length === 0 ? (
          <div className="roster-empty">
            Add characters to get started
          </div>
        ) : (
          <div className="roster-grid">
            {roster.map((npc) => {
              const isSaved = savedPremadeIds.has(npc.id);
              return (
                <div key={npc.id} className="roster-card">
                  <button
                    className="roster-card-remove"
                    onClick={() => onRemoveFromRoster(npc.id)}
                    title="Remove"
                  >
                    ×
                  </button>
                  <button
                    className={`roster-card-save ${isSaved ? "saved" : ""}`}
                    onClick={() => handleSaveAsPremade(npc)}
                    title={isSaved ? "Saved as premade" : "Save as premade"}
                  >
                    {isSaved ? "★" : "☆"}
                  </button>
                  {npc.customVoiceId && (
                    <span className="roster-card-voice" title="Custom voice">
                      🎙
                    </span>
                  )}
                  <div className="roster-card-avatar">{npc.avatar}</div>
                  <div
                    className="roster-card-name"
                    style={{ color: npc.color }}
                  >
                    {npc.name}
                  </div>
                  <div className="roster-card-traits">
                    {npc.personalityTraits.slice(0, 2).map((t) => (
                      <span key={t} className="trait-chip">
                        {t}
                      </span>
                    ))}
                  </div>
                  {npc.coreDesires[0] && (
                    <div className="roster-card-desire">
                      {npc.coreDesires[0]}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {creatorOpen && (
        <NpcCreator
          onClose={() => setCreatorOpen(false)}
          onCreateNpc={(npc) => {
            onAddToRoster(npc);
            setCreatorOpen(false);
          }}
          existingIds={roster.map((n) => n.id)}
        />
      )}

      {editingPremade && (
        <NpcCreator
          onClose={() => setEditingPremade(null)}
          onCreateNpc={handleEditSubmit}
          existingIds={allPremadeIds}
          initialNpc={premadeTemplateToNpc(editingPremade)}
          title="Edit Premade"
          submitLabel="Save"
        />
      )}

      {confirmDeleteId && deletingPremade && (
        <div className="modal-overlay" onClick={() => setConfirmDeleteId(null)}>
          <div
            className="modal-content confirm-delete-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Delete Premade</h3>
            <p>
              Are you sure you want to delete <strong>{deletingPremade.name}</strong>?
              This cannot be undone.
            </p>
            <div className="confirm-delete-actions">
              <button
                className="btn"
                onClick={() => setConfirmDeleteId(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleConfirmDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
