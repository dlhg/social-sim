import type { NPC, InventoryItem, EmotionalState } from "./types";
import { createNpc, initialNpcs, celebrityNpcs, celebrityNpcs2 } from "./npcs";

const STORAGE_KEY = "npc-playground-custom-premades";
const SEEDED_KEY = "npc-playground-premades-seeded";

export interface PremadeTemplate {
  id: string;
  name: string;
  avatar: string;
  color: string;
  spriteId?: string;
  personalityTraits: string[];
  coreDesires: string[];
  backstory?: string;
  secrets: string[];
  inventory: InventoryItem[];
  emotionalState?: Partial<EmotionalState>;
  emotionalBaselines?: Partial<EmotionalState>;
  customVoiceId?: string;
}

/** All built-in NPCs available as premade templates. */
const allBuiltInNpcs = [...initialNpcs, ...celebrityNpcs, ...celebrityNpcs2];

/** Seed built-in NPCs into localStorage, backfilling any missing ones on each load. */
export function ensurePremadeSeeded(): void {
  const existing = loadCustomPremades();
  if (!localStorage.getItem(SEEDED_KEY) && existing.length === 0) {
    // First ever load — seed all built-ins
    const builtIns = allBuiltInNpcs.map(npcToPremadeTemplate);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(builtIns));
  } else {
    // Backfill any new built-in characters missing from saved premades
    const existingIds = new Set(existing.map(t => t.id));
    const missing = allBuiltInNpcs
      .filter(npc => !existingIds.has(npc.id))
      .map(npcToPremadeTemplate);
    if (missing.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, ...missing]));
    }
  }
  localStorage.setItem(SEEDED_KEY, "1");
}

export function loadCustomPremades(): PremadeTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveCustomPremade(template: PremadeTemplate): void {
  const existing = loadCustomPremades();
  const idx = existing.findIndex((t) => t.id === template.id);
  if (idx >= 0) {
    existing[idx] = template;
  } else {
    existing.push(template);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}

export function deleteCustomPremade(id: string): void {
  const existing = loadCustomPremades();
  const filtered = existing.filter((t) => t.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

export function premadeTemplateToNpc(template: PremadeTemplate): NPC {
  return createNpc({
    id: template.id,
    name: template.name,
    avatar: template.avatar,
    color: template.color,
    spriteId: template.spriteId,
    personalityTraits: [...template.personalityTraits],
    coreDesires: [...template.coreDesires],
    backstory: template.backstory,
    secrets: [...template.secrets],
    inventory: template.inventory.map((item) => ({ ...item })),
    emotionalState: template.emotionalState,
    emotionalBaselines: template.emotionalBaselines,
    customVoiceId: template.customVoiceId,
  });
}

export function npcToPremadeTemplate(npc: NPC): PremadeTemplate {
  return {
    id: npc.id,
    name: npc.name,
    avatar: npc.avatar,
    color: npc.color,
    spriteId: npc.spriteId,
    personalityTraits: [...npc.personalityTraits],
    coreDesires: [...npc.coreDesires],
    backstory: npc.backstory,
    secrets: [...npc.secrets],
    inventory: npc.inventory.map((item) => ({
      ...item,
    })),
    emotionalState: { ...npc.emotionalState },
    emotionalBaselines: npc.emotionalBaselines ? { ...npc.emotionalBaselines } : undefined,
    customVoiceId: npc.customVoiceId,
  };
}
