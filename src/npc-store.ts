import type { NPC, EmotionalState, NpcPromise, BehavioralOverride, InventoryItem, ItemCategory, RelationshipState, ReactiveImpulse, BetrayalRecord } from "./types";

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
  private _batchDepth = 0;

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

  static readonly EMOTION_KEYS = ["anger", "trust", "fear", "joy", "sadness", "curiosity", "guilt"] as const;

  applyEmotionDelta(npcId: string, delta: EmotionalState): void {
    const npc = this.npcs.get(npcId);
    if (!npc) { console.warn(`[npc-store] applyEmotionDelta: NPC "${npcId}" not found`); return; }
    for (const key of NpcStore.EMOTION_KEYS) {
      npc.emotionalState[key] = clamp(
        npc.emotionalState[key] + delta[key],
        0,
        1
      );
    }
    this.notify();
  }

  private ensureRelationship(npc: NPC, targetId: string): RelationshipState {
    if (!npc.relationships[targetId]) {
      npc.relationships[targetId] = {
        regard: 0, affection: 0, respect: 0.3, trust: 0.3,
        fear: 0, disgust: 0, debt: 0, familiarity: 0,
      };
    }
    // Backfill new fields for existing relationships created before the upgrade
    const rel = npc.relationships[targetId];
    if (rel.respect === undefined) rel.respect = 0.3;
    if (rel.trust === undefined) rel.trust = 0.3;
    if (rel.fear === undefined) rel.fear = 0;
    if (rel.disgust === undefined) rel.disgust = 0;
    if (rel.debt === undefined) rel.debt = 0;
    if (rel.familiarity === undefined) rel.familiarity = 0;
    return rel;
  }

  applyRelationshipDelta(
    npcId: string,
    targetId: string,
    delta: number,
    affectionDelta = 0,
    extras?: { respect?: number; trust?: number; fear?: number; disgust?: number; debt?: number }
  ): void {
    const npc = this.npcs.get(npcId);
    if (!npc) { console.warn(`[npc-store] applyRelationshipDelta: NPC "${npcId}" not found`); return; }
    const rel = this.ensureRelationship(npc, targetId);
    rel.regard = clamp(rel.regard + delta, -1, 1);
    rel.affection = clamp(rel.affection + affectionDelta, 0, 1);
    if (extras) {
      if (extras.respect) rel.respect = clamp(rel.respect + extras.respect, 0, 1);
      if (extras.trust) rel.trust = clamp(rel.trust + extras.trust, 0, 1);
      if (extras.fear) rel.fear = clamp(rel.fear + extras.fear, 0, 1);
      if (extras.disgust) rel.disgust = clamp(rel.disgust + extras.disgust, 0, 1);
      if (extras.debt) rel.debt = clamp(rel.debt + extras.debt, -1, 1);
    }
    this.notify();
  }

  incrementFamiliarity(npcId: string, targetId: string, amount = 0.05): void {
    const npc = this.npcs.get(npcId);
    if (!npc) return;
    const rel = this.ensureRelationship(npc, targetId);
    rel.familiarity = clamp(rel.familiarity + amount, 0, 1);
    this.notify();
  }

  /** Get the regard value for a relationship (convenience helper) */
  getRegard(npcId: string, targetId: string): number {
    const npc = this.npcs.get(npcId);
    return npc?.relationships[targetId]?.regard ?? 0;
  }

  /** Get the affection value for a relationship */
  getAffection(npcId: string, targetId: string): number {
    const npc = this.npcs.get(npcId);
    return npc?.relationships[targetId]?.affection ?? 0;
  }

  setGoal(npcId: string, goal: string | null): void {
    const npc = this.npcs.get(npcId);
    if (!npc) { console.warn(`[npc-store] setGoal: NPC "${npcId}" not found`); return; }
    npc.currentGoal = goal;
    this.notify();
  }

  addNpc(npc: NPC): void {
    if (this.npcs.has(npc.id)) return;
    this.npcs.set(npc.id, structuredClone(npc));
    this.notify();
  }

  // ── Behavioral Overrides ───────────────────

  setBehavioralOverride(npcId: string, override: BehavioralOverride | null): void {
    const npc = this.npcs.get(npcId);
    if (!npc) { console.warn(`[npc-store] setBehavioralOverride: NPC "${npcId}" not found`); return; }
    npc.behavioralOverride = override;
    this.notify();
  }

  clearExpiredOverrides(): void {
    const now = Date.now();
    for (const npc of this.npcs.values()) {
      if (npc.behavioralOverride && npc.behavioralOverride.expiresAt <= now) {
        npc.behavioralOverride = null;
      }
    }
  }

  // ── Secrets & Promises ─────────────────────

  addKnownSecret(
    knowerNpcId: string,
    aboutNpcId: string,
    secret: string
  ): void {
    const npc = this.npcs.get(knowerNpcId);
    if (!npc) { console.warn(`[npc-store] addKnownSecret: NPC "${knowerNpcId}" not found`); return; }
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

  // ── Reactive Impulses ──────────────────────

  private reactiveImpulses: ReactiveImpulse[] = [];

  addReactiveImpulse(impulse: ReactiveImpulse): void {
    // Deduplicate: don't add if same NPC already has impulse toward same target
    const existing = this.reactiveImpulses.find(
      i => i.npcId === impulse.npcId && i.targetNpcId === impulse.targetNpcId
    );
    if (existing) {
      // Replace if new impulse is more urgent
      if (impulse.urgency > existing.urgency) {
        const idx = this.reactiveImpulses.indexOf(existing);
        this.reactiveImpulses[idx] = impulse;
      }
      return;
    }
    this.reactiveImpulses.push(impulse);
  }

  getReactiveImpulses(npcId: string): ReactiveImpulse[] {
    return this.reactiveImpulses.filter(i => i.npcId === npcId);
  }

  getReactiveImpulseForPair(npcAId: string, npcBId: string): ReactiveImpulse | undefined {
    return this.reactiveImpulses.find(
      i => (i.npcId === npcAId && i.targetNpcId === npcBId) ||
           (i.npcId === npcBId && i.targetNpcId === npcAId)
    );
  }

  consumeReactiveImpulse(npcId: string, targetNpcId: string): ReactiveImpulse | undefined {
    const idx = this.reactiveImpulses.findIndex(
      i => i.npcId === npcId && i.targetNpcId === targetNpcId
    );
    if (idx === -1) return undefined;
    return this.reactiveImpulses.splice(idx, 1)[0];
  }

  clearExpiredImpulses(): void {
    const now = Date.now();
    this.reactiveImpulses = this.reactiveImpulses.filter(i => i.expiresAt > now);
  }

  // ── Betrayal Tracking ──────────────────────

  private betrayals: BetrayalRecord[] = [];

  addBetrayal(record: BetrayalRecord): void {
    this.betrayals.push(record);
  }

  getBetrayals(victimId: string): BetrayalRecord[] {
    return this.betrayals.filter(b => b.victimId === victimId);
  }

  getBetrayalsBetween(npcAId: string, npcBId: string): BetrayalRecord[] {
    return this.betrayals.filter(
      b => (b.betrayerId === npcAId && b.victimId === npcBId) ||
           (b.betrayerId === npcBId && b.victimId === npcAId)
    );
  }

  /** Mark a betrayal as discovered by the victim */
  discoverBetrayal(betrayerId: string, victimId: string): BetrayalRecord | undefined {
    const b = this.betrayals.find(
      r => r.betrayerId === betrayerId && r.victimId === victimId && !r.discoveredByVictim
    );
    if (b) b.discoveredByVictim = true;
    return b;
  }

  /** Mark all discovered betrayals by a specific betrayer as forgiven */
  forgiveBetrayal(victimId: string, betrayerId: string): BetrayalRecord[] {
    const forgiven: BetrayalRecord[] = [];
    for (const b of this.betrayals) {
      if (b.victimId === victimId && b.betrayerId === betrayerId &&
          b.discoveredByVictim && !b.forgiven) {
        b.forgiven = true;
        b.forgivenAt = Date.now();
        forgiven.push(b);
      }
    }
    return forgiven;
  }

  /** Get unforgiven, discovered betrayals for an NPC (active grudges) */
  getActiveGrudges(victimId: string): BetrayalRecord[] {
    return this.betrayals.filter(
      b => b.victimId === victimId && b.discoveredByVictim && !b.forgiven
    );
  }

  // ── Character Arc & Mood ──────────────────

  setCharacterArc(npcId: string, arc: string): void {
    const npc = this.npcs.get(npcId);
    if (!npc) return;
    npc.characterArc = arc;
    this.notify();
  }

  /** Derive persistent mood from current emotional state. Returns the mood label or null. */
  computeAndSetMood(npcId: string): string | null {
    const npc = this.npcs.get(npcId);
    if (!npc) return null;

    const s = npc.emotionalState;
    let newMood: string | null = null;

    // Priority: negative moods first (most dramatically interesting)
    if (s.fear > 0.5 && s.trust < 0.3) newMood = "paranoid";
    else if (s.anger > 0.5 && s.trust < 0.3) newMood = "bitter";
    else if (s.sadness > 0.5) newMood = "melancholy";
    else if (s.guilt > 0.5) newMood = "guilt-ridden";
    else if (s.anger > 0.6) newMood = "volatile";
    else if (s.curiosity > 0.6 && s.joy < 0.3) newMood = "restless";
    // Positive moods
    else if (s.joy > 0.7) newMood = "euphoric";

    if (newMood !== npc.mood) {
      npc.mood = newMood ?? undefined;
      npc.moodSince = newMood ? Date.now() : undefined;
      this.notify();
    }
    return newMood;
  }

  // ── Inventory ────────────────────────────────

  addItem(npcId: string, item: InventoryItem): void {
    const npc = this.npcs.get(npcId);
    if (!npc) { console.warn(`[npc-store] addItem: NPC "${npcId}" not found`); return; }
    npc.inventory.push(item);
    if (npc.inventory.length > 8) {
      // Drop oldest item to keep inventory small
      npc.inventory.shift();
    }
    this.notify();
  }

  removeItem(npcId: string, itemId: string): InventoryItem | undefined {
    const npc = this.npcs.get(npcId);
    if (!npc) return undefined;
    const idx = npc.inventory.findIndex(i => i.id === itemId);
    if (idx === -1) return undefined;
    const [removed] = npc.inventory.splice(idx, 1);
    this.notify();
    return removed;
  }

  getItemsByCategory(npcId: string, category: ItemCategory): InventoryItem[] {
    const npc = this.npcs.get(npcId);
    if (!npc) return [];
    return npc.inventory.filter(i => i.category === category);
  }

  hasItemCategory(npcId: string, category: ItemCategory): boolean {
    return this.getItemsByCategory(npcId, category).length > 0;
  }

  // ── Decay ───────────────────────────────────

  static readonly DEFAULT_EMOTION_BASELINES: Record<string, number> = {
    anger: 0.3, trust: 0.3, fear: 0.3, joy: 0.3,
    sadness: 0.15, curiosity: 0.4, guilt: 0.1,
  };

  /** Pull all emotions toward per-NPC baselines (or global defaults) by the given rate. Call after each conversation. */
  decayEmotions(npcId: string, rate = 0.15): void {
    const npc = this.npcs.get(npcId);
    if (!npc) { console.warn(`[npc-store] decayEmotions: NPC "${npcId}" not found`); return; }
    const npcBaselines = npc.emotionalBaselines;
    for (const key of NpcStore.EMOTION_KEYS) {
      const baseline = npcBaselines?.[key] ?? NpcStore.DEFAULT_EMOTION_BASELINES[key] ?? 0.3;
      npc.emotionalState[key] += (baseline - npc.emotionalState[key]) * rate;
    }
    this.notify();
  }

  // ── Relationship History ────────────────────

  recordRelationshipSnapshot(npcAId: string, npcBId: string): void {
    const key = [npcAId, npcBId].sort().join(":");
    const npcA = this.npcs.get(npcAId);
    if (!npcA) return;
    const value = npcA.relationships[npcBId]?.regard ?? 0;
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

  // ── Batching ────────────────────────────────

  /** Suppress notify() during fn, then fire a single notify when done. */
  batch(fn: () => void): void {
    this._batchDepth++;
    try {
      fn();
    } finally {
      this._batchDepth--;
      if (this._batchDepth === 0) {
        this.notify();
      }
    }
  }

  // ── Subscription ─────────────────────────────

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Notify listeners of a state change. Used by MemoryService. */
  notifyChange(): void {
    this.notify();
  }

  private notify(): void {
    if (this._batchDepth > 0) return;
    for (const listener of this.listeners) {
      listener();
    }
  }
}
