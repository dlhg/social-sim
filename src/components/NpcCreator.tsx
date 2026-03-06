import { useState } from "react";
import { createNpc, AVATAR_OPTIONS, COLOR_SWATCHES } from "../npcs";
import type { NPC } from "../types";

interface NpcCreatorProps {
  onClose: () => void;
  onCreateNpc: (npc: NPC) => void;
  existingIds: string[];
}

export function NpcCreator({
  onClose,
  onCreateNpc,
  existingIds,
}: NpcCreatorProps) {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("😀");
  const [color, setColor] = useState("#4dd0e1");
  const [traits, setTraits] = useState("");
  const [desires, setDesires] = useState("");
  const [secrets, setSecrets] = useState("");
  const [error, setError] = useState("");

  const derivedId = name.trim().toLowerCase().replace(/\s+/g, "-");
  const isDuplicate = derivedId !== "" && existingIds.includes(derivedId);

  function handleSubmit() {
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

    const npc = createNpc({
      id: derivedId,
      name: trimmed,
      avatar,
      color,
      personalityTraits: parsedTraits,
      coreDesires: parsedDesires,
      secrets: parsedSecrets,
    });

    onCreateNpc(npc);
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>Create NPC</h3>

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

        {error && <div className="form-error">{error}</div>}

        <button className="btn-spawn" onClick={handleSubmit}>
          Spawn
        </button>
      </div>
    </div>
  );
}
