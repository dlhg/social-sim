import { useState } from "react";
import { createNpc, randomizeFields, AVATAR_OPTIONS, COLOR_SWATCHES, RANDOM_ITEMS } from "../npcs";
import type { NPC, InventoryItem, ItemCategory } from "../types";

interface NpcCreatorProps {
  onClose: () => void;
  onCreateNpc: (npc: NPC) => void;
  existingIds: string[];
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
}: NpcCreatorProps) {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("😀");
  const [color, setColor] = useState("#4dd0e1");
  const [traits, setTraits] = useState("");
  const [desires, setDesires] = useState("");
  const [secrets, setSecrets] = useState("");
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [error, setError] = useState("");

  const derivedId = name.trim().toLowerCase().replace(/\s+/g, "-");
  const isDuplicate = derivedId !== "" && existingIds.includes(derivedId);

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
      },
    ]);
  }

  function removeItem(itemId: string) {
    setInventory((prev) => prev.filter((i) => i.id !== itemId));
  }

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
      inventory,
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
          <h3>Create NPC</h3>
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

        <button className="btn-spawn" onClick={handleSubmit}>
          Spawn
        </button>
      </div>
    </div>
  );
}
