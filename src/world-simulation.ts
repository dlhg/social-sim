import type { Position, Waypoint, NpcSpatialState, WorldSnapshot, EmotionalState, DayPhase } from "./types";
import type { NpcStore } from "./npc-store";
import type { MemoryService } from "./memory-service";
import { ACTIVITIES, shouldDoActivity, pickActivity, activityDurationTicks, buildActivityMemory, rollItemYield } from "./activities";
import { weightedPick } from "./random";

/** Fallback waypoints — used only if no tilemap waypoints are provided. */
const FALLBACK_WAYPOINTS: Waypoint[] = [
  { id: "center", name: "Center", position: { x: 36, y: 24 }, moods: ["gathering"], description: "the center of the map" },
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
  /** Fires when an NPC finishes a solo activity at a reflective waypoint — opportunity for inner monologue */
  onSoliloquyTrigger?: (npcId: string, waypointName: string, activityLabel: string) => void;
  onTick?: () => void;
  getPhase?: () => DayPhase;
  npcStore?: NpcStore;
  memoryService?: MemoryService;
  waypoints?: Waypoint[];
  collisionGrid?: boolean[];
}

export class WorldSimulation {
  private npcs: Map<string, NpcSpatialState> = new Map();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private paused = false;
  private slowNpcIds: Set<string> = new Set();
  private stuckTicks: Map<string, number> = new Map();
  /** Precomputed A* paths per NPC. */
  private npcPaths: Map<string, Position[]> = new Map();

  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly tickIntervalMs: number;
  readonly waypoints: ReadonlyArray<Waypoint>;
  private collisionGrid: boolean[] = [];
  private onProximity: (a: string, b: string) => void;
  private onActivityStart: ((npcId: string, activityId: string, waypointName: string) => void) | null;
  private onActivityEnd: ((npcId: string, activityId: string, waypointName: string, memoryText: string) => void) | null;
  private onItemAcquired: ((npcId: string, itemLabel: string, itemEmoji: string) => void) | null;
  private onObserveActivity: ((observerId: string, actorId: string, activityId: string) => void) | null;
  private onSoliloquyTrigger: ((npcId: string, waypointName: string, activityLabel: string) => void) | null;
  private onTickCallback: (() => void) | null;
  /** Track which observer→actor observations already fired to avoid spam */
  private observationCooldowns: Map<string, number> = new Map();
  /** Per-NPC per-activity cooldowns to prevent repetitive actions (e.g., cooking 8 meals) */
  private activityCooldowns: Map<string, number> = new Map();
  private readonly ACTIVITY_COOLDOWN_MS = 300_000; // 5 minutes before repeating same activity
  private lastItemDecay = 0;
  private lastCooldownPurge = 0;
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
    this.onSoliloquyTrigger = options.onSoliloquyTrigger ?? null;
    this.onTickCallback = options.onTick ?? null;
    this.getPhase = options.getPhase ?? null;
    this.npcStore = options.npcStore ?? null;
    this.memoryService = options.memoryService ?? null;
    this.waypoints = options.waypoints && options.waypoints.length > 0
      ? options.waypoints
      : FALLBACK_WAYPOINTS;
    this.collisionGrid = options.collisionGrid ?? [];
  }

  addNpc(npcId: string, startPosition?: Position): void {
    const preferred = startPosition ?? this.randomWaypoint().position;
    const pos = this.findOpenTileNear(preferred);
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

  /** Find the nearest open (non-collision, non-occupied) tile via spiral search. */
  private findOpenTileNear(pos: Position): Position {
    for (let radius = 0; radius <= 10; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue; // only check perimeter
          const candidate = { x: pos.x + dx, y: pos.y + dy };
          if (candidate.x < 0 || candidate.x >= this.gridWidth) continue;
          if (candidate.y < 0 || candidate.y >= this.gridHeight) continue;
          // Check collision grid
          if (this.collisionGrid.length > 0) {
            if (this.collisionGrid[candidate.y * this.gridWidth + candidate.x]) continue;
          }
          // Check NPC overlap
          let occupied = false;
          for (const other of this.npcs.values()) {
            if (other.position.x === candidate.x && other.position.y === candidate.y) {
              occupied = true;
              break;
            }
          }
          if (!occupied) return candidate;
        }
      }
    }
    return pos; // fallback
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
      this.npcPaths.delete(npcId);
    }
  }

  unfreezeNpc(npcId: string): void {
    const npc = this.npcs.get(npcId);
    if (npc) {
      npc.frozen = false;
      npc.destination = null;
      npc.idleTicksRemaining = 3;
      this.npcPaths.delete(npcId);
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
        const dest = Math.random() < 0.25
          ? this.pickWanderTarget(npc)
          : this.pickDestination(npc);
        npc.destination = dest;

        // Compute A* path to destination
        const path = this.computePath(npc.position, dest.position);
        if (path && path.length > 0) {
          this.npcPaths.set(npc.npcId, path);
        } else {
          // Unreachable — pick a different destination next tick
          npc.destination = null;
          npc.idleTicksRemaining = 2;
          continue;
        }
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
        this.npcPaths.delete(npc.npcId);

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

      // Follow precomputed A* path
      let path = this.npcPaths.get(npc.npcId);
      if (!path || path.length === 0) {
        // Path exhausted but not at destination — recompute
        const newPath = this.computePath(npc.position, dest);
        if (newPath && newPath.length > 0) {
          this.npcPaths.set(npc.npcId, newPath);
          path = newPath;
        } else {
          npc.destination = null;
          npc.idleTicksRemaining = 2;
          this.npcPaths.delete(npc.npcId);
          continue;
        }
      }

      let movedThisTick = false;
      for (let step = 0; step < STEPS_PER_TICK; step++) {
        if (path.length === 0) break;
        const next = path[0];

        // Check NPC-NPC collision (tile collision already handled by A*)
        if (this.isBlockedByNpc(next, npc)) break; // wait for them to move

        path.shift();
        npc.position.x = next.x;
        npc.position.y = next.y;
        movedThisTick = true;
      }

      // Stuck detection: if blocked by NPCs too long, recompute path around them
      if (!movedThisTick) {
        npc.previousPosition = { ...npc.position };
        const stuck = (this.stuckTicks.get(npc.npcId) ?? 0) + 1;
        this.stuckTicks.set(npc.npcId, stuck);
        if (stuck >= STUCK_THRESHOLD) {
          // Recompute, this time including NPC positions as obstacles
          const reroute = this.computePath(npc.position, dest, true);
          if (reroute && reroute.length > 0) {
            this.npcPaths.set(npc.npcId, reroute);
          } else {
            npc.destination = null;
            npc.idleTicksRemaining = 2;
            this.npcPaths.delete(npc.npcId);
          }
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
    this.purgeStaleCooldowns(now);
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

    const candidates = this.waypoints.filter(
      (wp) =>
        wp.position.x !== npc.position.x || wp.position.y !== npc.position.y
    );
    if (candidates.length === 0) return this.waypoints[0];

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
      const moods = wp.moods;
      if (moods.length > 0) {
        if (moods.includes("reflective") && (emo.fear > 0.4 || emo.joy < 0.3))
          score += 1.5;
        if (moods.includes("social") && emo.joy > 0.5) score += 1.5;
        if (moods.includes("intimate") && emo.trust > 0.6) score += 1;
        if (moods.includes("gathering") && traits.includes("enthusiastic"))
          score += 1;
        if (moods.includes("mysterious") && traits.includes("curious"))
          score += 2;
      }

      // 5. Time-of-day preferences
      const phase = this.getPhase?.();
      if (phase && moods.length > 0) {
        if (phase === "morning") {
          // Morning: prefer reflective, peaceful spots
          if (moods.includes("reflective")) score += 1.5;
          if (moods.includes("gathering")) score -= 0.5;
        } else if (phase === "afternoon") {
          // Afternoon: prefer social, busy spots
          if (moods.includes("social") || moods.includes("gathering")) score += 1;
        } else if (phase === "evening") {
          // Evening: prefer intimate, social spots (tavern, bench)
          if (moods.includes("intimate")) score += 1.5;
          if (moods.includes("social")) score += 1;
          if (moods.includes("mysterious")) score += 1;
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

    return weightedPick(scores, s => s.score).wp;
  }

  private pickOverrideDestination(npc: NpcSpatialState, npcData: import("./types").NPC): Waypoint | null {
    const override = npcData.behavioralOverride!;
    const targetSpatial = this.npcs.get(override.targetNpcId);

    if (!targetSpatial) {
      // Target not in world, clear override
      this.npcStore?.setBehavioralOverride(npc.npcId, null);
      return null;
    }

    const candidates = this.waypoints.filter(
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
    const candidates = this.waypoints.filter(
      (wp) =>
        wp.position.x !== npc.position.x || wp.position.y !== npc.position.y
    );
    if (candidates.length === 0) return this.waypoints[0];
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

  // ── Collision & Pathfinding ────────────────

  private isBlockedByNpc(pos: Position, self: NpcSpatialState): boolean {
    for (const other of this.npcs.values()) {
      if (other.npcId === self.npcId) continue;
      if (pos.x === other.position.x && pos.y === other.position.y) return true;
    }
    return false;
  }

  /** A* pathfinding. Returns array of positions (excluding start). */
  private computePath(from: Position, to: Position, avoidNpcs = false): Position[] | null {
    const gw = this.gridWidth;
    const gh = this.gridHeight;
    const startKey = from.y * gw + from.x;
    const endKey = to.y * gw + to.x;
    if (startKey === endKey) return [];

    const heuristic = (x: number, y: number) => Math.abs(x - to.x) + Math.abs(y - to.y);

    // Collect NPC positions as obstacles when rerouting around stuck NPCs
    let npcBlocked: Set<number> | null = null;
    if (avoidNpcs) {
      npcBlocked = new Set<number>();
      for (const other of this.npcs.values()) {
        npcBlocked.add(other.position.y * gw + other.position.x);
      }
      // Don't block start or end
      npcBlocked.delete(startKey);
      npcBlocked.delete(endKey);
    }

    // Open set: binary heap by f-score (min-heap via array)
    const gScore = new Float32Array(gw * gh).fill(Infinity);
    const cameFrom = new Int32Array(gw * gh).fill(-1);
    const inClosed = new Uint8Array(gw * gh);

    gScore[startKey] = 0;

    // Simple heap: [f, key] pairs
    const heap: [number, number][] = [[heuristic(from.x, from.y), startKey]];

    const DIRS = [
      [0, -1], [0, 1], [-1, 0], [1, 0],
    ];

    const MAX_ITER = 3000;
    let iter = 0;

    while (heap.length > 0 && iter < MAX_ITER) {
      iter++;

      // Pop min f-score
      const [, ck] = this.heapPop(heap);
      if (ck === endKey) break;
      if (inClosed[ck]) continue;
      inClosed[ck] = 1;

      const cx = ck % gw;
      const cy = (ck - cx) / gw;
      const cg = gScore[ck];

      for (const [ddx, ddy] of DIRS) {
        const nx = cx + ddx;
        const ny = cy + ddy;
        if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;

        const nk = ny * gw + nx;
        if (inClosed[nk]) continue;
        if (this.collisionGrid.length > 0 && this.collisionGrid[nk]) continue;
        if (npcBlocked && npcBlocked.has(nk)) continue;

        const ng = cg + 1;
        if (ng >= gScore[nk]) continue;

        gScore[nk] = ng;
        cameFrom[nk] = ck;
        this.heapPush(heap, [ng + heuristic(nx, ny), nk]);
      }
    }

    // Reconstruct path
    if (cameFrom[endKey] === -1 && startKey !== endKey) return null;

    const path: Position[] = [];
    let k = endKey;
    while (k !== startKey) {
      const x = k % gw;
      const y = (k - x) / gw;
      path.push({ x, y });
      k = cameFrom[k];
      if (k === -1) return null; // broken chain
    }
    path.reverse();
    return path;
  }

  private heapPush(heap: [number, number][], item: [number, number]) {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= heap[i][0]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  }

  private heapPop(heap: [number, number][]): [number, number] {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      const len = heap.length;
      while (true) {
        let smallest = i;
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        if (l < len && heap[l][0] < heap[smallest][0]) smallest = l;
        if (r < len && heap[r][0] < heap[smallest][0]) smallest = r;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
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

  /** Check if an NPC has any other NPCs within range */
  private isNpcNearOthers(npcId: string, range: number): boolean {
    const npc = this.npcs.get(npcId);
    if (!npc) return false;
    return this.getNpcsWithinRange(npc.position, range, [npcId]).length > 0;
  }

  getNearestWaypoint(npcId: string): Waypoint | undefined {
    const npc = this.npcs.get(npcId);
    if (!npc) return undefined;
    let best: Waypoint | undefined;
    let bestDist = Infinity;
    for (const wp of this.waypoints) {
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

    const waypoint = this.waypoints.find(wp => wp.id === activity.waypointId);
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

    // Soliloquy trigger: reflective waypoints + solo activities → inner monologue opportunity
    if (this.onSoliloquyTrigger && waypoint) {
      const isReflective = waypoint.moods?.some(
        m => ["reflective", "intimate", "mysterious"].includes(m)
      );
      const isAlone = !this.isNpcNearOthers(npc.npcId, 5);
      if (isReflective && isAlone) {
        const actLabel = actDef?.label ?? activity.activityId;
        this.onSoliloquyTrigger(npc.npcId, waypointName, actLabel);
      }
    }

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

  /** Pick a random walkable tile 5-15 tiles away for an idle stroll. */
  private pickWanderTarget(npc: NpcSpatialState): Waypoint {
    const range = 5 + Math.floor(Math.random() * 11);
    for (let attempt = 0; attempt < 15; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = range * (0.5 + Math.random() * 0.5);
      const tx = Math.round(npc.position.x + Math.cos(angle) * dist);
      const ty = Math.round(npc.position.y + Math.sin(angle) * dist);
      if (tx < 1 || tx >= this.gridWidth - 1 || ty < 1 || ty >= this.gridHeight - 1) continue;
      if (this.collisionGrid.length > 0 && this.collisionGrid[ty * this.gridWidth + tx]) continue;
      return { id: "_wander", name: "strolling", position: { x: tx, y: ty }, moods: [] };
    }
    // Fallback to a real waypoint
    return this.pickDestination(npc);
  }

  private randomWaypoint(): Waypoint {
    return this.waypoints[Math.floor(Math.random() * this.waypoints.length)];
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

  /** Periodically prune expired entries from cooldown/history maps to prevent unbounded growth. */
  private purgeStaleCooldowns(now: number): void {
    // Run every 60 seconds
    if (now - this.lastCooldownPurge < 60_000) return;
    this.lastCooldownPurge = now;

    const activeNpcIds = new Set(this.npcs.keys());

    // Purge observation cooldowns older than 3 min or for removed NPCs
    for (const [key, timestamp] of this.observationCooldowns) {
      if (now - timestamp > 180_000) this.observationCooldowns.delete(key);
    }

    // Purge activity cooldowns older than 5 min or for removed NPCs
    for (const [key, timestamp] of this.activityCooldowns) {
      if (now - timestamp > this.ACTIVITY_COOLDOWN_MS) this.activityCooldowns.delete(key);
    }

    // Purge visit history and lastInteractionTime for removed NPCs
    for (const id of this.visitHistory.keys()) {
      if (!activeNpcIds.has(id)) this.visitHistory.delete(id);
    }
    for (const id of this.lastInteractionTime.keys()) {
      if (!activeNpcIds.has(id)) this.lastInteractionTime.delete(id);
    }
  }

  private randomIdleTicks(): number {
    return (
      IDLE_TICKS_MIN +
      Math.floor(Math.random() * (IDLE_TICKS_MAX - IDLE_TICKS_MIN + 1))
    );
  }
}
