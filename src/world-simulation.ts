import type { Position, Waypoint, NpcSpatialState, WorldSnapshot, EmotionalState, DayPhase } from "./types";
import type { NpcStore } from "./npc-store";
import type { MemoryService } from "./memory-service";
import { ACTIVITIES, shouldDoActivity, pickActivity, activityDurationTicks, buildActivityMemory, rollItemYield } from "./activities";

export const WAYPOINTS: Waypoint[] = [
  { id: "fountain", name: "Fountain", position: { x: 36, y: 24 }, mood: "gathering", description: "the central fountain, a busy gathering place" },
  { id: "bench", name: "Park Bench", position: { x: 12, y: 36 }, mood: "intimate", description: "a secluded park bench, good for private talks" },
  { id: "tree", name: "Old Tree", position: { x: 60, y: 12 }, mood: "reflective", description: "an ancient tree, a quiet spot for contemplation" },
  { id: "garden", name: "Garden", position: { x: 21, y: 9 }, mood: "reflective", description: "a peaceful garden with winding paths" },
  { id: "market", name: "Market", position: { x: 54, y: 39 }, mood: "social", description: "the bustling market square" },
  { id: "well", name: "Well", position: { x: 9, y: 21 }, mood: "mysterious", description: "an old well at the edge of town, rumored to grant wishes" },
  { id: "bridge", name: "Bridge", position: { x: 45, y: 30 }, mood: "social", description: "a stone bridge, a natural meeting point" },
  { id: "chapel", name: "Chapel", position: { x: 3, y: 6 }, mood: "reflective", description: "a small stone chapel, hushed and reverent" },
  { id: "training_yard", name: "Training Yard", position: { x: 66, y: 27 }, mood: "gathering", description: "a dusty training yard with wooden dummies" },
  { id: "library_ruins", name: "Library Ruins", position: { x: 30, y: 3 }, mood: "mysterious", description: "crumbling library ruins, books still scattered among the stones" },
  { id: "tavern_porch", name: "Tavern Porch", position: { x: 24, y: 42 }, mood: "social", description: "the porch of a weathered tavern, smelling of bread and ale" },
  { id: "hilltop", name: "Hilltop", position: { x: 63, y: 3 }, mood: "reflective", description: "a windswept hilltop with a view of the whole town" },
  { id: "pond", name: "Pond", position: { x: 42, y: 15 }, mood: "intimate", description: "a quiet pond surrounded by reeds" },
];

const PROXIMITY_THRESHOLD = 5;
const ARRIVAL_RADIUS = 2;
const STEPS_PER_TICK = 3;
const STUCK_THRESHOLD = 8;
const IDLE_TICKS_MIN = 5;
const IDLE_TICKS_MAX = 25;

export interface WorldSimulationOptions {
  gridWidth: number;
  gridHeight: number;
  tickIntervalMs: number;
  onProximity: (npcAId: string, npcBId: string) => void;
  onActivityStart?: (npcId: string, activityId: string, waypointName: string) => void;
  onActivityEnd?: (npcId: string, activityId: string, waypointName: string, memoryText: string) => void;
  onItemAcquired?: (npcId: string, itemLabel: string, itemEmoji: string) => void;
  onObserveActivity?: (observerId: string, actorId: string, activityId: string) => void;
  onTick?: () => void;
  getPhase?: () => DayPhase;
  npcStore?: NpcStore;
  memoryService?: MemoryService;
}

export class WorldSimulation {
  private npcs: Map<string, NpcSpatialState> = new Map();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private paused = false;
  private slowNpcIds: Set<string> = new Set();
  private stuckTicks: Map<string, number> = new Map();

  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly tickIntervalMs: number;
  readonly waypoints: ReadonlyArray<Waypoint> = WAYPOINTS;
  private onProximity: (a: string, b: string) => void;
  private onActivityStart: ((npcId: string, activityId: string, waypointName: string) => void) | null;
  private onActivityEnd: ((npcId: string, activityId: string, waypointName: string, memoryText: string) => void) | null;
  private onItemAcquired: ((npcId: string, itemLabel: string, itemEmoji: string) => void) | null;
  private onObserveActivity: ((observerId: string, actorId: string, activityId: string) => void) | null;
  private onTickCallback: (() => void) | null;
  /** Track which observer→actor observations already fired to avoid spam */
  private observationCooldowns: Map<string, number> = new Map();
  /** Per-NPC per-activity cooldowns to prevent repetitive actions (e.g., cooking 8 meals) */
  private activityCooldowns: Map<string, number> = new Map();
  private readonly ACTIVITY_COOLDOWN_MS = 300_000; // 5 minutes before repeating same activity
  private lastItemDecay = 0;
  private getPhase: (() => DayPhase) | null;
  private npcStore: NpcStore | null;
  private memoryService: MemoryService | null;
  private visitHistory: Map<string, Map<string, number>> = new Map();

  constructor(options: WorldSimulationOptions) {
    this.gridWidth = options.gridWidth;
    this.gridHeight = options.gridHeight;
    this.tickIntervalMs = options.tickIntervalMs;
    this.onProximity = options.onProximity;
    this.onActivityStart = options.onActivityStart ?? null;
    this.onActivityEnd = options.onActivityEnd ?? null;
    this.onItemAcquired = options.onItemAcquired ?? null;
    this.onObserveActivity = options.onObserveActivity ?? null;
    this.onTickCallback = options.onTick ?? null;
    this.getPhase = options.getPhase ?? null;
    this.npcStore = options.npcStore ?? null;
    this.memoryService = options.memoryService ?? null;
  }

  addNpc(npcId: string, startPosition?: Position): void {
    const pos = startPosition ?? this.randomWaypoint().position;
    // Stagger initial social timers so NPCs don't all get lonely at once
    this.lastInteractionTime.set(npcId, Date.now() + Math.random() * 60_000);
    this.npcs.set(npcId, {
      npcId,
      position: { ...pos },
      previousPosition: { ...pos },
      lastTickTime: Date.now(),
      destination: null,
      idleTicksRemaining: this.randomIdleTicks(),
      frozen: false,
      activeActivity: null,
    });
  }

  // ── Lifecycle ────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.tickTimer = setInterval(() => this.tick(), this.tickIntervalMs);
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  stop(): void {
    this.running = false;
    this.paused = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  // ── Speed control ──────────────────────────────

  setSlowNpc(npcId: string, slow: boolean): void {
    if (slow) {
      this.slowNpcIds.add(npcId);
    } else {
      this.slowNpcIds.delete(npcId);
    }
  }

  // ── Freeze / Unfreeze ────────────────────────

  freezeNpc(npcId: string): void {
    const npc = this.npcs.get(npcId);
    if (npc) {
      npc.frozen = true;
      npc.activeActivity = null;
    }
  }

  unfreezeNpc(npcId: string): void {
    const npc = this.npcs.get(npcId);
    if (npc) {
      npc.frozen = false;
      npc.destination = null;
      npc.idleTicksRemaining = 3;
    }
  }

  // ── Snapshot for renderer ────────────────────

  getSnapshot(): WorldSnapshot {
    return {
      npcs: Array.from(this.npcs.values()),
      waypoints: this.waypoints,
      tickIntervalMs: this.tickIntervalMs,
    };
  }

  // ── Simulation tick ──────────────────────────

  private tick(): void {
    if (this.paused) return;

    const now = Date.now();

    for (const npc of this.npcs.values()) {
      if (npc.frozen) continue;

      // Activity tick — busy NPCs do nothing else
      if (npc.activeActivity) {
        npc.activeActivity.ticksRemaining--;
        if (npc.activeActivity.ticksRemaining <= 0) {
          this.completeActivity(npc);
        }
        continue;
      }

      if (npc.idleTicksRemaining > 0) {
        npc.idleTicksRemaining--;
        continue;
      }

      // NPCs with active bubbles move slower (~30% of ticks skipped)
      if (this.slowNpcIds.has(npc.npcId) && Math.random() < 0.3) {
        continue;
      }

      if (!npc.destination) {
        npc.destination = this.pickDestination(npc);
      }

      const dest = npc.destination.position;
      const distToDest = Math.abs(npc.position.x - dest.x) + Math.abs(npc.position.y - dest.y);
      if (distToDest <= ARRIVAL_RADIUS) {
        // Record visit for recency tracking
        if (!this.visitHistory.has(npc.npcId)) {
          this.visitHistory.set(npc.npcId, new Map());
        }
        this.visitHistory.get(npc.npcId)!.set(npc.destination.id, Date.now());
        this.stuckTicks.delete(npc.npcId);

        // Try to start an activity at this waypoint
        const arrivedWaypoint = npc.destination;
        npc.destination = null;
        if (this.tryStartActivity(npc, arrivedWaypoint)) {
          continue;
        }

        npc.idleTicksRemaining = this.randomIdleTicks();
        continue;
      }

      // Save previous position for lerp (before all steps this tick)
      npc.previousPosition = { ...npc.position };
      npc.lastTickTime = now;

      // Take multiple steps per tick to maintain visual speed on the larger grid
      let movedThisTick = false;
      for (let step = 0; step < STEPS_PER_TICK; step++) {
        const dx = dest.x - npc.position.x;
        const dy = dest.y - npc.position.y;
        if (dx === 0 && dy === 0) break;

        // Build candidate moves: direct first, perpendicular detours, then backward
        const candidates: Position[] = [];
        const { x, y } = npc.position;
        if (dx !== 0 && dy !== 0) {
          if (Math.random() < 0.5) {
            candidates.push({ x: x + Math.sign(dx), y });
            candidates.push({ x, y: y + Math.sign(dy) });
          } else {
            candidates.push({ x, y: y + Math.sign(dy) });
            candidates.push({ x: x + Math.sign(dx), y });
          }
          // Backward as last resort
          candidates.push({ x: x - Math.sign(dx), y });
          candidates.push({ x, y: y - Math.sign(dy) });
        } else if (dx !== 0) {
          candidates.push({ x: x + Math.sign(dx), y });
          const perpDir = Math.random() < 0.5 ? 1 : -1;
          candidates.push({ x, y: y + perpDir });
          candidates.push({ x, y: y - perpDir });
          candidates.push({ x: x - Math.sign(dx), y });
        } else {
          candidates.push({ x, y: y + Math.sign(dy) });
          const perpDir = Math.random() < 0.5 ? 1 : -1;
          candidates.push({ x: x + perpDir, y });
          candidates.push({ x: x - perpDir, y });
          candidates.push({ x, y: y - Math.sign(dy) });
        }

        const inBounds = candidates.filter(
          c => c.x >= 0 && c.x < this.gridWidth && c.y >= 0 && c.y < this.gridHeight
        );
        let moved = false;
        for (const candidate of inBounds) {
          if (!this.isTooCloseToOthers(candidate, npc)) {
            npc.position.x = candidate.x;
            npc.position.y = candidate.y;
            moved = true;
            movedThisTick = true;
            break;
          }
        }
        if (!moved) break; // blocked, stop stepping
      }

      // Stuck detection: if blocked too long, pick a new destination
      if (!movedThisTick) {
        npc.previousPosition = { ...npc.position };
        const stuck = (this.stuckTicks.get(npc.npcId) ?? 0) + 1;
        this.stuckTicks.set(npc.npcId, stuck);
        if (stuck >= STUCK_THRESHOLD) {
          npc.destination = null;
          npc.idleTicksRemaining = 2;
          this.stuckTicks.delete(npc.npcId);
        }
      } else {
        this.stuckTicks.delete(npc.npcId);
      }
    }

    this.checkProximity();
    this.checkActivityObservations();
    this.decayItems(now);
    this.checkDrives(now);
    this.onTickCallback?.();
  }

  private pickDestination(npc: NpcSpatialState): Waypoint {
    if (!this.npcStore) {
      return this.randomPickFallback(npc);
    }

    const npcData = this.npcStore.get(npc.npcId);
    if (!npcData) return this.randomPickFallback(npc);

    // Clear expired behavioral overrides
    if (npcData.behavioralOverride && npcData.behavioralOverride.expiresAt <= Date.now()) {
      this.npcStore.setBehavioralOverride(npc.npcId, null);
    }

    // Handle active behavioral overrides (seek/avoid)
    if (npcData.behavioralOverride) {
      const overrideDest = this.pickOverrideDestination(npc, npcData);
      if (overrideDest) return overrideDest;
    }

    const candidates = WAYPOINTS.filter(
      (wp) =>
        wp.position.x !== npc.position.x || wp.position.y !== npc.position.y
    );
    if (candidates.length === 0) return WAYPOINTS[0];

    const scores = candidates.map((wp) => {
      let score = 0;

      // 1. Relationship-based: who's near this waypoint?
      for (const otherSpatial of this.npcs.values()) {
        if (otherSpatial.npcId === npc.npcId) continue;
        const distToWp =
          Math.abs(otherSpatial.position.x - wp.position.x) +
          Math.abs(otherSpatial.position.y - wp.position.y);
        if (distToWp <= 9) {
          const rel = npcData.relationships[otherSpatial.npcId]?.regard ?? 0;
          const isAggressive = npcData.personalityTraits.some((t) =>
            ["competitive", "aggressive", "confrontational", "contrarian"].includes(
              t.toLowerCase()
            )
          );
          if (isAggressive && rel < -0.2) {
            score += 2; // seek out enemies
          } else {
            score += rel * 3; // positive = approach, negative = avoid
          }
        }
      }

      // 2. Emotional state preferences
      const emo = npcData.emotionalState;
      const busyness = this.waypointBusyness(wp);
      if (emo.fear > 0.5) score -= busyness * 2; // fearful → avoid crowds
      if (emo.joy > 0.6) score += busyness * 1; // joyful → seek social
      if (emo.anger > 0.5) score -= busyness * 0.5; // angry → slight avoidance

      // 3. Personality traits
      const traits = npcData.personalityTraits.map((t) => t.toLowerCase());
      if (traits.includes("curious")) score += Math.random() * 2;
      if (
        traits.includes("anxious") ||
        traits.includes("suspicious")
      ) {
        const centerDist =
          Math.abs(wp.position.x - this.gridWidth / 2) +
          Math.abs(wp.position.y - this.gridHeight / 2);
        score += centerDist * 0.1;
      }
      if (traits.includes("charming") || traits.includes("flattering")) {
        score += busyness * 0.5; // social NPCs seek people
      }

      // 4. Waypoint mood matching
      if (wp.mood) {
        if (wp.mood === "reflective" && (emo.fear > 0.4 || emo.joy < 0.3))
          score += 1.5;
        if (wp.mood === "social" && emo.joy > 0.5) score += 1.5;
        if (wp.mood === "intimate" && emo.trust > 0.6) score += 1;
        if (wp.mood === "gathering" && traits.includes("enthusiastic"))
          score += 1;
        if (wp.mood === "mysterious" && traits.includes("curious"))
          score += 2;
      }

      // 5. Time-of-day preferences
      const phase = this.getPhase?.();
      if (phase && wp.mood) {
        if (phase === "morning") {
          // Morning: prefer reflective, peaceful spots
          if (wp.mood === "reflective") score += 1.5;
          if (wp.mood === "gathering") score -= 0.5;
        } else if (phase === "afternoon") {
          // Afternoon: prefer social, busy spots
          if (wp.mood === "social" || wp.mood === "gathering") score += 1;
        } else if (phase === "evening") {
          // Evening: prefer intimate, social spots (tavern, bench)
          if (wp.mood === "intimate") score += 1.5;
          if (wp.mood === "social") score += 1;
          if (wp.mood === "mysterious") score += 1;
        }
      }

      // 6. Recency penalty: avoid just-visited waypoints
      const lastVisit =
        this.visitHistory.get(npc.npcId)?.get(wp.id) ?? 0;
      const secsSinceVisit = (Date.now() - lastVisit) / 1000;
      if (secsSinceVisit < 30) score -= 3;
      else if (secsSinceVisit < 60) score -= 1;

      return { wp, score };
    });

    // Softmax-weighted random selection
    const maxScore = Math.max(...scores.map((s) => s.score));
    const weights = scores.map((s) => Math.exp(s.score - maxScore));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalWeight;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return scores[i].wp;
    }
    return scores[scores.length - 1].wp;
  }

  private pickOverrideDestination(npc: NpcSpatialState, npcData: import("./types").NPC): Waypoint | null {
    const override = npcData.behavioralOverride!;
    const targetSpatial = this.npcs.get(override.targetNpcId);

    if (!targetSpatial) {
      // Target not in world, clear override
      this.npcStore?.setBehavioralOverride(npc.npcId, null);
      return null;
    }

    const candidates = WAYPOINTS.filter(
      (wp) => wp.position.x !== npc.position.x || wp.position.y !== npc.position.y
    );
    if (candidates.length === 0) return null;

    if (override.mode === "seek") {
      // Find waypoint closest to the target NPC
      let bestWp = candidates[0];
      let bestDist = Infinity;
      for (const wp of candidates) {
        const dist = Math.abs(wp.position.x - targetSpatial.position.x)
                   + Math.abs(wp.position.y - targetSpatial.position.y);
        if (dist < bestDist) {
          bestDist = dist;
          bestWp = wp;
        }
      }
      return bestWp;
    }

    if (override.mode === "avoid") {
      // Find waypoint farthest from the target NPC
      let bestWp = candidates[0];
      let bestDist = -Infinity;
      for (const wp of candidates) {
        const dist = Math.abs(wp.position.x - targetSpatial.position.x)
                   + Math.abs(wp.position.y - targetSpatial.position.y);
        if (dist > bestDist) {
          bestDist = dist;
          bestWp = wp;
        }
      }
      return bestWp;
    }

    return null;
  }

  private waypointBusyness(wp: Waypoint): number {
    let count = 0;
    for (const npc of this.npcs.values()) {
      const dist =
        Math.abs(npc.position.x - wp.position.x) +
        Math.abs(npc.position.y - wp.position.y);
      if (dist <= 6) count++;
    }
    return count;
  }

  private randomPickFallback(npc: NpcSpatialState): Waypoint {
    const candidates = WAYPOINTS.filter(
      (wp) =>
        wp.position.x !== npc.position.x || wp.position.y !== npc.position.y
    );
    if (candidates.length === 0) return WAYPOINTS[0];
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  private checkProximity(): void {
    const npcList = Array.from(this.npcs.values());
    for (let i = 0; i < npcList.length; i++) {
      for (let j = i + 1; j < npcList.length; j++) {
        const a = npcList[i];
        const b = npcList[j];
        if (a.frozen || b.frozen) continue;
        if (a.activeActivity || b.activeActivity) continue; // busy NPCs can't be interrupted

        // Respect avoidance overrides — don't trigger conversation
        if (this.npcStore) {
          const npcA = this.npcStore.get(a.npcId);
          const npcB = this.npcStore.get(b.npcId);
          if (npcA?.behavioralOverride?.mode === "avoid" && npcA.behavioralOverride.targetNpcId === b.npcId) continue;
          if (npcB?.behavioralOverride?.mode === "avoid" && npcB.behavioralOverride.targetNpcId === a.npcId) continue;
        }

        const dist =
          Math.abs(a.position.x - b.position.x) +
          Math.abs(a.position.y - b.position.y);
        if (dist <= PROXIMITY_THRESHOLD) {
          this.onProximity(a.npcId, b.npcId);
        }
      }
    }
  }

  private checkActivityObservations(): void {
    if (!this.onObserveActivity) return;

    const OBSERVE_RANGE = 6;
    const OBSERVE_COOLDOWN_MS = 180_000; // 3 minutes between observations of same pair
    const now = Date.now();

    const npcList = Array.from(this.npcs.values());
    for (const actor of npcList) {
      if (!actor.activeActivity) continue;

      for (const observer of npcList) {
        if (observer.npcId === actor.npcId) continue;
        if (observer.frozen || observer.activeActivity) continue;

        const dist =
          Math.abs(observer.position.x - actor.position.x) +
          Math.abs(observer.position.y - actor.position.y);
        if (dist > OBSERVE_RANGE) continue;

        const key = `${observer.npcId}:${actor.npcId}`;
        const lastObserve = this.observationCooldowns.get(key) ?? 0;
        if (now - lastObserve < OBSERVE_COOLDOWN_MS) continue;

        // Filter: only observe if socially relevant
        let relevant = false;
        if (this.npcStore) {
          const observerNpc = this.npcStore.get(observer.npcId);
          const actorNpc = this.npcStore.get(actor.npcId);
          if (observerNpc && actorNpc) {
            const rel = observerNpc.relationships[actor.npcId]?.regard ?? 0;
            // Relevant if: they have a relationship (positive or negative), or observer is perceptive/curious/suspicious
            const curiousTraits = ["perceptive", "suspicious", "curious", "calculating", "nosy"];
            const hasCuriousTrait = observerNpc.personalityTraits.some(t => curiousTraits.includes(t.toLowerCase()));
            relevant = Math.abs(rel) > 0.15 || hasCuriousTrait;
          }
        }
        if (!relevant) continue;

        // Reduced trigger rate: ~3% of eligible ticks
        if (Math.random() > 0.03) continue;

        this.observationCooldowns.set(key, now);
        this.onObserveActivity(observer.npcId, actor.npcId, actor.activeActivity.activityId);
      }
    }
  }

  // ── Collision avoidance ────────────────────

  private isTooCloseToOthers(pos: Position, npc: NpcSpatialState): boolean {
    for (const other of this.npcs.values()) {
      if (other.npcId === npc.npcId) continue;
      if (pos.x === other.position.x && pos.y === other.position.y) return true;
    }
    return false;
  }

  // ── Spatial queries ─────────────────────────

  getNpcPosition(npcId: string): Position | undefined {
    return this.npcs.get(npcId)?.position;
  }

  getNpcsWithinRange(
    center: Position,
    range: number,
    excludeIds: string[]
  ): string[] {
    const result: string[] = [];
    for (const npc of this.npcs.values()) {
      if (excludeIds.includes(npc.npcId)) continue;
      const dist =
        Math.abs(npc.position.x - center.x) +
        Math.abs(npc.position.y - center.y);
      if (dist <= range) result.push(npc.npcId);
    }
    return result;
  }

  getNearestWaypoint(npcId: string): Waypoint | undefined {
    const npc = this.npcs.get(npcId);
    if (!npc) return undefined;
    let best: Waypoint | undefined;
    let bestDist = Infinity;
    for (const wp of WAYPOINTS) {
      const d =
        Math.abs(npc.position.x - wp.position.x) +
        Math.abs(npc.position.y - wp.position.y);
      if (d < bestDist) {
        bestDist = d;
        best = wp;
      }
    }
    return bestDist <= 9 ? best : undefined;
  }

  // ── Activities ─────────────────────────────────

  private tryStartActivity(npc: NpcSpatialState, waypoint: Waypoint): boolean {
    if (!this.npcStore) return false;
    if (!shouldDoActivity()) return false;

    const npcData = this.npcStore.get(npc.npcId);
    if (!npcData) return false;

    // Try up to 3 times to find a non-cooldown activity
    const now = Date.now();
    for (let attempt = 0; attempt < 3; attempt++) {
      const activityId = pickActivity(waypoint.id, npcData);
      if (!activityId) return false;

      // Check per-NPC per-activity cooldown
      const cooldownKey = `${npc.npcId}:${activityId}`;
      const lastDone = this.activityCooldowns.get(cooldownKey) ?? 0;
      if (now - lastDone < this.ACTIVITY_COOLDOWN_MS) continue;

      const duration = activityDurationTicks(activityId);
      npc.activeActivity = {
        activityId,
        waypointId: waypoint.id,
        ticksRemaining: duration,
        totalTicks: duration,
        startedAt: now,
      };

      this.activityCooldowns.set(cooldownKey, now);
      this.onActivityStart?.(npc.npcId, activityId, waypoint.name);
      return true;
    }

    return false;
  }

  private completeActivity(npc: NpcSpatialState): void {
    const activity = npc.activeActivity;
    if (!activity) return;

    const waypoint = WAYPOINTS.find(wp => wp.id === activity.waypointId);
    const waypointName = waypoint?.name ?? activity.waypointId;
    const memoryText = buildActivityMemory(activity.activityId, waypointName);

    // Apply emotion effect
    const actDef = ACTIVITIES[activity.activityId];
    if (actDef.emotionEffect && this.npcStore) {
      const effect: EmotionalState = {
        anger: actDef.emotionEffect.anger ?? 0,
        trust: actDef.emotionEffect.trust ?? 0,
        fear: actDef.emotionEffect.fear ?? 0,
        joy: actDef.emotionEffect.joy ?? 0,
        sadness: actDef.emotionEffect.sadness ?? 0,
        curiosity: actDef.emotionEffect.curiosity ?? 0,
        disgust: actDef.emotionEffect.disgust ?? 0,
        guilt: actDef.emotionEffect.guilt ?? 0,
      };
      this.npcStore.applyEmotionDelta(npc.npcId, effect);
    }

    // Create memory
    if (this.memoryService) {
      this.memoryService.add(npc.npcId, {
        text: memoryText,
        importance: 0.3,
        recency: 1,
        emotionalWeight: 0.2,
        involvedNpcIds: [],
        timestamp: Date.now(),
        type: "activity",
      });
    }

    this.onActivityEnd?.(npc.npcId, activity.activityId, waypointName, memoryText);

    // Roll for item yield
    if (this.npcStore) {
      const item = rollItemYield(activity.activityId);
      if (item) {
        this.npcStore.addItem(npc.npcId, item);
        this.onItemAcquired?.(npc.npcId, item.label, item.emoji);
      }
    }

    npc.activeActivity = null;
    npc.idleTicksRemaining = 3;
  }

  getNpcActivity(npcId: string): import("./types").ActiveActivity | null {
    return this.npcs.get(npcId)?.activeActivity ?? null;
  }

  // ── Helpers ──────────────────────────────────

  private randomWaypoint(): Waypoint {
    return WAYPOINTS[Math.floor(Math.random() * WAYPOINTS.length)];
  }

  // ── Drives: NPC-initiated seeking & social needs ──

  private lastDriveCheck = 0;
  private lastInteractionTime: Map<string, number> = new Map();

  /** Record that an NPC just had a social interaction (conversation or interaction) */
  recordSocialContact(npcId: string): void {
    this.lastInteractionTime.set(npcId, Date.now());
  }

  private checkDrives(now: number): void {
    if (!this.npcStore) return;
    // Check every ~10 seconds
    if (now - this.lastDriveCheck < 10_000) return;
    this.lastDriveCheck = now;

    for (const spatial of this.npcs.values()) {
      if (spatial.frozen) continue;
      if (spatial.activeActivity) continue;

      const npc = this.npcStore.get(spatial.npcId);
      if (!npc) continue;
      // Don't override existing behavioral overrides
      if (npc.behavioralOverride) continue;

      // Drive 1: Gift-seeking — NPC has items and a friend nearby-ish
      if (npc.inventory.length > 0) {
        const bestFriend = this.findBestFriend(npc);
        if (bestFriend && Math.random() < 0.3) {
          this.npcStore.setBehavioralOverride(spatial.npcId, {
            mode: "seek",
            targetNpcId: bestFriend,
            expiresAt: now + 60_000,
            reason: "want to give a gift",
          });
          continue;
        }
      }

      // Drive 2: Loneliness — seek social contact if isolated too long
      const lastSocial = this.lastInteractionTime.get(spatial.npcId) ?? 0;
      const lonelySecs = (now - lastSocial) / 1000;
      if (lonelySecs > 90 && Math.random() < 0.15) {
        // Find someone they like (or anyone if desperate)
        const target = this.findBestFriend(npc) ?? this.findNearestOther(spatial);
        if (target) {
          this.npcStore.setBehavioralOverride(spatial.npcId, {
            mode: "seek",
            targetNpcId: target,
            expiresAt: now + 45_000,
            reason: "feeling lonely",
          });
          continue;
        }
      }

      // Drive 3: Restlessness — NPCs with high anger/fear and no activity seek action waypoints
      if ((npc.emotionalState.anger > 0.6 || npc.emotionalState.fear > 0.6) && Math.random() < 0.1) {
        // Let the normal destination picker handle this — it already scores for emotions.
        // But nudge by clearing their current destination so they re-pick
        if (spatial.destination && !spatial.frozen) {
          spatial.destination = null;
          spatial.idleTicksRemaining = 0;
        }
      }
    }
  }

  private findBestFriend(npc: import("./types").NPC): string | null {
    let best: string | null = null;
    let bestRel = 0.2; // minimum threshold
    for (const [otherId, relState] of Object.entries(npc.relationships)) {
      const regard = relState?.regard ?? 0;
      if (regard > bestRel && this.npcs.has(otherId)) {
        bestRel = regard;
        best = otherId;
      }
    }
    return best;
  }

  private findNearestOther(spatial: NpcSpatialState): string | null {
    let nearest: string | null = null;
    let nearestDist = Infinity;
    for (const other of this.npcs.values()) {
      if (other.npcId === spatial.npcId) continue;
      if (other.frozen) continue;
      const dist = Math.abs(other.position.x - spatial.position.x)
                 + Math.abs(other.position.y - spatial.position.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = other.npcId;
      }
    }
    return nearest;
  }

  private decayItems(now: number): void {
    if (!this.npcStore) return;
    // Check every ~30 seconds
    if (now - this.lastItemDecay < 30_000) return;
    this.lastItemDecay = now;

    for (const npc of this.npcStore.getAll()) {
      const expired = npc.inventory.filter(i => now - i.acquiredAt > (i.lifetimeMs ?? 5 * 60_000));
      for (const item of expired) {
        this.npcStore.removeItem(npc.id, item.id);
      }
    }
  }

  private randomIdleTicks(): number {
    return (
      IDLE_TICKS_MIN +
      Math.floor(Math.random() * (IDLE_TICKS_MAX - IDLE_TICKS_MIN + 1))
    );
  }
}
