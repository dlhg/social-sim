import type { Position, Waypoint, NpcSpatialState, WorldSnapshot } from "./types";

const WAYPOINTS: Waypoint[] = [
  { id: "fountain", name: "Fountain", position: { x: 12, y: 8 } },
  { id: "bench", name: "Park Bench", position: { x: 4, y: 12 } },
  { id: "tree", name: "Old Tree", position: { x: 20, y: 4 } },
  { id: "garden", name: "Garden", position: { x: 7, y: 3 } },
  { id: "market", name: "Market", position: { x: 18, y: 13 } },
  { id: "well", name: "Well", position: { x: 3, y: 7 } },
  { id: "bridge", name: "Bridge", position: { x: 15, y: 10 } },
];

const PROXIMITY_THRESHOLD = 2;
const IDLE_TICKS_MIN = 5;
const IDLE_TICKS_MAX = 25;

export interface WorldSimulationOptions {
  gridWidth: number;
  gridHeight: number;
  tickIntervalMs: number;
  onProximity: (npcAId: string, npcBId: string) => void;
}

export class WorldSimulation {
  private npcs: Map<string, NpcSpatialState> = new Map();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private paused = false;

  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly tickIntervalMs: number;
  readonly waypoints: ReadonlyArray<Waypoint> = WAYPOINTS;
  private onProximity: (a: string, b: string) => void;

  constructor(options: WorldSimulationOptions) {
    this.gridWidth = options.gridWidth;
    this.gridHeight = options.gridHeight;
    this.tickIntervalMs = options.tickIntervalMs;
    this.onProximity = options.onProximity;
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

  // ── Freeze / Unfreeze ────────────────────────

  freezeNpc(npcId: string): void {
    const npc = this.npcs.get(npcId);
    if (npc) npc.frozen = true;
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

      if (npc.idleTicksRemaining > 0) {
        npc.idleTicksRemaining--;
        continue;
      }

      if (!npc.destination) {
        npc.destination = this.pickDestination(npc);
      }

      const dest = npc.destination.position;
      if (npc.position.x === dest.x && npc.position.y === dest.y) {
        npc.destination = null;
        npc.idleTicksRemaining = this.randomIdleTicks();
        continue;
      }

      // Save previous position for lerp
      npc.previousPosition = { ...npc.position };
      npc.lastTickTime = now;

      // Step one tile toward destination
      const dx = dest.x - npc.position.x;
      const dy = dest.y - npc.position.y;

      if (dx !== 0 && dy !== 0) {
        if (Math.random() < 0.5) {
          npc.position.x += Math.sign(dx);
        } else {
          npc.position.y += Math.sign(dy);
        }
      } else if (dx !== 0) {
        npc.position.x += Math.sign(dx);
      } else {
        npc.position.y += Math.sign(dy);
      }
    }

    this.checkProximity();
  }

  private pickDestination(npc: NpcSpatialState): Waypoint {
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
