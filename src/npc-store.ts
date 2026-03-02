import type { NPC, EmotionalState, MemoryEntry } from "./types";

type Listener = () => void;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class NpcStore {
  private npcs: Map<string, NPC>;
  private listeners: Set<Listener> = new Set();

  constructor(initialNpcs: NPC[]) {
    this.npcs = new Map(
      initialNpcs.map((npc) => [npc.id, structuredClone(npc)])
    );
  }

  // ── Reads ────────────────────────────────────

  get(id: string): NPC | undefined {
    return this.npcs.get(id);
  }

  getAll(): NPC[] {
    return Array.from(this.npcs.values());
  }

  // ── Mutations ────────────────────────────────

  applyEmotionDelta(npcId: string, delta: EmotionalState): void {
    const npc = this.npcs.get(npcId);
    if (!npc) return;
    for (const key of ["anger", "trust", "fear", "joy"] as const) {
      npc.emotionalState[key] = clamp(
        npc.emotionalState[key] + delta[key],
        0,
        1
      );
    }
    this.notify();
  }

  applyRelationshipDelta(
    npcId: string,
    targetId: string,
    delta: number
  ): void {
    const npc = this.npcs.get(npcId);
    if (!npc) return;
    const current = npc.relationships[targetId] ?? 0;
    npc.relationships[targetId] = clamp(current + delta, -1, 1);
    this.notify();
  }

  addMemory(
    npcId: string,
    entry: MemoryEntry,
    slot: "shortTermMemory" | "longTermMemory"
  ): void {
    const npc = this.npcs.get(npcId);
    if (!npc) return;
    npc[slot].push(entry);
    if (slot === "shortTermMemory" && npc.shortTermMemory.length > 20) {
      npc.shortTermMemory.shift();
    }
    this.notify();
  }

  setGoal(npcId: string, goal: string | null): void {
    const npc = this.npcs.get(npcId);
    if (!npc) return;
    npc.currentGoal = goal;
    this.notify();
  }

  // ── Subscription ─────────────────────────────

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
