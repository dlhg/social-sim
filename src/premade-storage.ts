import type { NPC, InventoryItem, EmotionalState } from "./types";
import { createNpc, initialNpcs } from "./npcs";

const STORAGE_KEY = "npc-playground-custom-premades";
const SEEDED_KEY = "npc-playground-premades-seeded";

export interface PremadeTemplate {
  id: string;
  name: string;
  avatar: string;
  color: string;
  personalityTraits: string[];
  coreDesires: string[];
  backstory?: string;
  secrets: string[];
  inventory: InventoryItem[];
  emotionalState?: Partial<EmotionalState>;
  customVoiceId?: string;
}

/** Seed built-in NPCs into localStorage on first ever load. */
export function ensurePremadeSeeded(): void {
  if (localStorage.getItem(SEEDED_KEY)) return;
  const existing = loadCustomPremades();
  if (existing.length === 0) {
    const builtIns = initialNpcs.map(npcToPremadeTemplate);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(builtIns));
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
    personalityTraits: [...template.personalityTraits],
    coreDesires: [...template.coreDesires],
    backstory: template.backstory,
    secrets: [...template.secrets],
    inventory: template.inventory.map((item) => ({ ...item })),
    emotionalState: template.emotionalState,
    customVoiceId: template.customVoiceId,
  });
}

export function npcToPremadeTemplate(npc: NPC): PremadeTemplate {
  return {
    id: npc.id,
    name: npc.name,
    avatar: npc.avatar,
    color: npc.color,
    personalityTraits: [...npc.personalityTraits],
    coreDesires: [...npc.coreDesires],
    backstory: npc.backstory,
    secrets: [...npc.secrets],
    inventory: npc.inventory.map((item) => ({
      ...item,
    })),
    emotionalState: { ...npc.emotionalState },
    customVoiceId: npc.customVoiceId,
  };
}
