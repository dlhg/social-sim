import { useState } from "react";
import { initialNpcs, randomizeNpc } from "../npcs";
import { NpcCreator } from "./NpcCreator";
import type { NPC } from "../types";

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

interface SetupScreenProps {
  roster: NPC[];
  language: string;
  onAddToRoster: (npc: NPC) => void;
  onRemoveFromRoster: (npcId: string) => void;
  onLanguageChange: (language: string) => void;
  onStartSimulation: () => void;
}

export function SetupScreen({
  roster,
  language,
  onAddToRoster,
  onRemoveFromRoster,
  onLanguageChange,
  onStartSimulation,
}: SetupScreenProps) {
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [creatorOpen, setCreatorOpen] = useState(false);

  const rosterIds = new Set(roster.map((n) => n.id));
  const atCapacity = roster.length >= MAX_ROSTER;

  return (
    <div className="setup-screen">
      <div className="setup-header">
        <h1 className="setup-title">NPC Playground</h1>
        <p className="setup-subtitle">Assemble your cast</p>
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
            {roster.map((npc) => (
              <div key={npc.id} className="roster-card">
                <button
                  className="roster-card-remove"
                  onClick={() => onRemoveFromRoster(npc.id)}
                  title="Remove"
                >
                  ×
                </button>
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
            ))}
          </div>
        )}
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
            {initialNpcs.map((npc) => {
              const added = rosterIds.has(npc.id);
              return (
                <button
                  key={npc.id}
                  className={`premade-card ${added ? "premade-card-added" : ""}`}
                  disabled={added || atCapacity}
                  onClick={() => onAddToRoster(npc)}
                >
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
                </button>
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

      <div className="setup-start-area">
        <button
          className="btn btn-start-sim"
          disabled={roster.length < 2}
          onClick={onStartSimulation}
        >
          Start Simulation
        </button>
        {roster.length < 2 && (
          <p className="setup-start-hint">Add at least 2 characters</p>
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
    </div>
  );
}
