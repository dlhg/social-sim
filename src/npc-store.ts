import type { NPC, EmotionalState, MemoryEntry, NpcPromise } from "./types";

type Listener = () => void;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export interface RelationshipVelocity {
  trend: "improving" | "declining" | "stable";
  values: number[];
}

export class NpcStore {
  private npcs: Map<string, NPC>;
  private listeners: Set<Listener> = new Set();
  private relationshipHistory: Map<string, number[]> = new Map();

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

  addNpc(npc: NPC): void {
    if (this.npcs.has(npc.id)) return;
    this.npcs.set(npc.id, structuredClone(npc));
    this.notify();
  }

  // ── Secrets & Promises ─────────────────────

  addKnownSecret(
    knowerNpcId: string,
    aboutNpcId: string,
    secret: string
  ): void {
    const npc = this.npcs.get(knowerNpcId);
    if (!npc) return;
    if (!npc.knownSecrets[aboutNpcId]) {
      npc.knownSecrets[aboutNpcId] = [];
    }
    if (!npc.knownSecrets[aboutNpcId].includes(secret)) {
      npc.knownSecrets[aboutNpcId].push(secret);
    }
    this.notify();
  }

  private promises: NpcPromise[] = [];

  addPromise(promise: NpcPromise): void {
    this.promises.push(promise);
    this.notify();
  }

  getPromises(): NpcPromise[] {
    return this.promises;
  }

  getPromisesFor(npcId: string): NpcPromise[] {
    return this.promises.filter(
      (p) => p.promiserId === npcId || p.promiseeId === npcId
    );
  }

  // ── Decay ───────────────────────────────────

  /** Pull all emotions toward a baseline (0.3) by the given rate. Call after each conversation. */
  decayEmotions(npcId: string, rate = 0.15): void {
    const npc = this.npcs.get(npcId);
    if (!npc) return;
    const baseline = 0.3;
    for (const key of ["anger", "trust", "fear", "joy"] as const) {
      npc.emotionalState[key] += (baseline - npc.emotionalState[key]) * rate;
    }
    this.notify();
  }

  /** Decay memory recency for all NPCs. Call after each conversation. */
  decayAllMemoryRecency(rate = 0.85): void {
    for (const npc of this.npcs.values()) {
      for (const mem of npc.shortTermMemory) {
        mem.recency *= rate;
      }
      for (const mem of npc.longTermMemory) {
        mem.recency *= rate;
      }
    }
    // No notify needed — this is gradual background decay
  }

  // ── Relationship History ────────────────────

  recordRelationshipSnapshot(npcAId: string, npcBId: string): void {
    const key = [npcAId, npcBId].sort().join(":");
    const npcA = this.npcs.get(npcAId);
    if (!npcA) return;
    const value = npcA.relationships[npcBId] ?? 0;
    if (!this.relationshipHistory.has(key)) {
      this.relationshipHistory.set(key, []);
    }
    const history = this.relationshipHistory.get(key)!;
    history.push(value);
    if (history.length > 10) history.shift();
  }

  getRelationshipVelocity(
    npcAId: string,
    npcBId: string
  ): RelationshipVelocity {
    const key = [npcAId, npcBId].sort().join(":");
    const history = this.relationshipHistory.get(key) ?? [];
    if (history.length < 2) return { trend: "stable", values: history };
    const recent = history.slice(-3);
    const avgDelta =
      (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
    if (avgDelta > 0.03) return { trend: "improving", values: history };
    if (avgDelta < -0.03) return { trend: "declining", values: history };
    return { trend: "stable", values: history };
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
