import type { Position, Waypoint, NpcSpatialState, WorldSnapshot, EmotionalState } from "./types";
import type { NpcStore } from "./npc-store";
import { ACTIVITIES, shouldDoActivity, pickActivity, activityDurationTicks, buildActivityMemory } from "./activities";

export const WAYPOINTS: Waypoint[] = [
  { id: "fountain", name: "Fountain", position: { x: 12, y: 8 }, mood: "gathering", description: "the central fountain, a busy gathering place" },
  { id: "bench", name: "Park Bench", position: { x: 4, y: 12 }, mood: "intimate", description: "a secluded park bench, good for private talks" },
  { id: "tree", name: "Old Tree", position: { x: 20, y: 4 }, mood: "reflective", description: "an ancient tree, a quiet spot for contemplation" },
  { id: "garden", name: "Garden", position: { x: 7, y: 3 }, mood: "reflective", description: "a peaceful garden with winding paths" },
  { id: "market", name: "Market", position: { x: 18, y: 13 }, mood: "social", description: "the bustling market square" },
  { id: "well", name: "Well", position: { x: 3, y: 7 }, mood: "mysterious", description: "an old well at the edge of town, rumored to grant wishes" },
  { id: "bridge", name: "Bridge", position: { x: 15, y: 10 }, mood: "social", description: "a stone bridge, a natural meeting point" },
  { id: "chapel", name: "Chapel", position: { x: 1, y: 2 }, mood: "reflective", description: "a small stone chapel, hushed and reverent" },
  { id: "training_yard", name: "Training Yard", position: { x: 22, y: 9 }, mood: "gathering", description: "a dusty training yard with wooden dummies" },
  { id: "library_ruins", name: "Library Ruins", position: { x: 10, y: 1 }, mood: "mysterious", description: "crumbling library ruins, books still scattered among the stones" },
  { id: "tavern_porch", name: "Tavern Porch", position: { x: 8, y: 14 }, mood: "social", description: "the porch of a weathered tavern, smelling of bread and ale" },
  { id: "hilltop", name: "Hilltop", position: { x: 21, y: 1 }, mood: "reflective", description: "a windswept hilltop with a view of the whole town" },
  { id: "pond", name: "Pond", position: { x: 14, y: 5 }, mood: "intimate", description: "a quiet pond surrounded by reeds" },
];

const PROXIMITY_THRESHOLD = 2;
const IDLE_TICKS_MIN = 5;
const IDLE_TICKS_MAX = 25;

export interface WorldSimulationOptions {
  gridWidth: number;
  gridHeight: number;
  tickIntervalMs: number;
  onProximity: (npcAId: string, npcBId: string) => void;
  onActivityStart?: (npcId: string, activityId: string, waypointName: string) => void;
  onActivityEnd?: (npcId: string, activityId: string, waypointName: string, memoryText: string) => void;
  npcStore?: NpcStore;
}

export class WorldSimulation {
  private npcs: Map<string, NpcSpatialState> = new Map();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private paused = false;
  private slowNpcIds: Set<string> = new Set();

  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly tickIntervalMs: number;
  readonly waypoints: ReadonlyArray<Waypoint> = WAYPOINTS;
  private onProximity: (a: string, b: string) => void;
  private onActivityStart: ((npcId: string, activityId: string, waypointName: string) => void) | null;
  private onActivityEnd: ((npcId: string, activityId: string, waypointName: string, memoryText: string) => void) | null;
  private npcStore: NpcStore | null;
  private visitHistory: Map<string, Map<string, number>> = new Map();

  constructor(options: WorldSimulationOptions) {
    this.gridWidth = options.gridWidth;
    this.gridHeight = options.gridHeight;
    this.tickIntervalMs = options.tickIntervalMs;
    this.onProximity = options.onProximity;
    this.onActivityStart = options.onActivityStart ?? null;
    this.onActivityEnd = options.onActivityEnd ?? null;
    this.npcStore = options.npcStore ?? null;
  }

  addNpc(npcId: string, startPosition?: Position): void {
    const pos = startPosition ?? this.randomWaypoint().position;
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
      if (npc.position.x === dest.x && npc.position.y === dest.y) {
        // Record visit for recency tracking
        if (!this.visitHistory.has(npc.npcId)) {
          this.visitHistory.set(npc.npcId, new Map());
        }
        this.visitHistory.get(npc.npcId)!.set(npc.destination.id, Date.now());

        // Try to start an activity at this waypoint
        const arrivedWaypoint = npc.destination;
        npc.destination = null;
        if (this.tryStartActivity(npc, arrivedWaypoint)) {
          continue;
        }

        npc.idleTicksRemaining = this.randomIdleTicks();
        continue;
      }

      // Save previous position for lerp
      npc.previousPosition = { ...npc.position };
      npc.lastTickTime = now;

      // Step one tile toward destination, avoiding other NPCs
      const dx = dest.x - npc.position.x;
      const dy = dest.y - npc.position.y;

      // Build list of candidate moves: direct moves first, then perpendicular detours
      const candidates: Position[] = [];
      const { x, y } = npc.position;
      if (dx !== 0 && dy !== 0) {
        // Diagonal: both direct moves, then neither is a detour since both help
        if (Math.random() < 0.5) {
          candidates.push({ x: x + Math.sign(dx), y });
          candidates.push({ x, y: y + Math.sign(dy) });
        } else {
          candidates.push({ x, y: y + Math.sign(dy) });
          candidates.push({ x: x + Math.sign(dx), y });
        }
      } else if (dx !== 0) {
        candidates.push({ x: x + Math.sign(dx), y });
        // Perpendicular detours when moving along x-axis
        const perpDir = Math.random() < 0.5 ? 1 : -1;
        candidates.push({ x, y: y + perpDir });
        candidates.push({ x, y: y - perpDir });
      } else {
        candidates.push({ x, y: y + Math.sign(dy) });
        // Perpendicular detours when moving along y-axis
        const perpDir = Math.random() < 0.5 ? 1 : -1;
        candidates.push({ x: x + perpDir, y });
        candidates.push({ x: x - perpDir, y });
      }

      // Filter to in-bounds candidates, then pick first that doesn't crowd another NPC
      const inBounds = candidates.filter(
        c => c.x >= 0 && c.x < this.gridWidth && c.y >= 0 && c.y < this.gridHeight
      );
      let moved = false;
      for (const candidate of inBounds) {
        if (!this.isTooCloseToOthers(candidate, npc)) {
          npc.position.x = candidate.x;
          npc.position.y = candidate.y;
          moved = true;
          break;
        }
      }

      // If all moves are blocked, stay put this tick
      if (!moved) {
        npc.previousPosition = { ...npc.position };
      }
    }

    this.checkProximity();
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
        if (distToWp <= 3) {
          const rel = npcData.relationships[otherSpatial.npcId] ?? 0;
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

      // 5. Recency penalty: avoid just-visited waypoints
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
      if (dist <= 2) count++;
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
          return;
        }
      }
    }
  }

  // ── Collision avoidance ────────────────────

  private isTooCloseToOthers(pos: Position, npc: NpcSpatialState): boolean {
    for (const other of this.npcs.values()) {
      if (other.npcId === npc.npcId) continue;
      const newDist = Math.abs(pos.x - other.position.x) + Math.abs(pos.y - other.position.y);
      if (newDist > 1) continue;
      // Only block if this move doesn't increase distance (allow separating)
      const curDist = Math.abs(npc.position.x - other.position.x) + Math.abs(npc.position.y - other.position.y);
      if (newDist <= curDist) return true;
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
    return bestDist <= 3 ? best : undefined;
  }

  // ── Activities ─────────────────────────────────

  private tryStartActivity(npc: NpcSpatialState, waypoint: Waypoint): boolean {
    if (!this.npcStore) return false;
    if (!shouldDoActivity()) return false;

    const npcData = this.npcStore.get(npc.npcId);
    if (!npcData) return false;

    const activityId = pickActivity(waypoint.id, npcData);
    if (!activityId) return false;

    const duration = activityDurationTicks(activityId);
    npc.activeActivity = {
      activityId,
      waypointId: waypoint.id,
      ticksRemaining: duration,
      totalTicks: duration,
      startedAt: Date.now(),
    };

    this.onActivityStart?.(npc.npcId, activityId, waypoint.name);
    return true;
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
      };
      this.npcStore.applyEmotionDelta(npc.npcId, effect);
    }

    // Create memory
    if (this.npcStore) {
      this.npcStore.addMemory(npc.npcId, {
        text: memoryText,
        importance: 0.3,
        recency: 1,
        emotionalWeight: 0.2,
        involvedNpcIds: [],
        timestamp: Date.now(),
        type: "activity",
      }, "shortTermMemory");
    }

    this.onActivityEnd?.(npc.npcId, activity.activityId, waypointName, memoryText);

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

  private randomIdleTicks(): number {
    return (
      IDLE_TICKS_MIN +
      Math.floor(Math.random() * (IDLE_TICKS_MAX - IDLE_TICKS_MIN + 1))
    );
  }
}
