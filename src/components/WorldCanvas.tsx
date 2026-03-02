import { useEffect, useRef } from "react";
import type { NPC } from "../types";
import type { WorldSnapshot, NpcSpatialState } from "../types";

interface WorldCanvasProps {
  getSnapshot: () => WorldSnapshot;
  getNpc: (id: string) => NPC | undefined;
  currentSpeaker: string | null;
  activeConversationPair: [string, string] | null;
}

const GRID_WIDTH = 24;
const GRID_HEIGHT = 16;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpFactor(
  spatial: NpcSpatialState,
  now: number,
  tickMs: number
): number {
  return Math.min(1, (now - spatial.lastTickTime) / tickMs);
}

function lerpX(
  spatial: NpcSpatialState,
  now: number,
  tickMs: number
): number {
  return lerp(
    spatial.previousPosition.x,
    spatial.position.x,
    lerpFactor(spatial, now, tickMs)
  );
}

function lerpY(
  spatial: NpcSpatialState,
  now: number,
  tickMs: number
): number {
  return lerp(
    spatial.previousPosition.y,
    spatial.position.y,
    lerpFactor(spatial, now, tickMs)
  );
}

export function WorldCanvas({
  getSnapshot,
  getNpc,
  currentSpeaker,
  activeConversationPair,
}: WorldCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  // Store props in refs so the rAF loop always reads fresh values
  const getSnapshotRef = useRef(getSnapshot);
  const getNpcRef = useRef(getNpc);
  const speakerRef = useRef(currentSpeaker);
  const pairRef = useRef(activeConversationPair);

  getSnapshotRef.current = getSnapshot;
  getNpcRef.current = getNpc;
  speakerRef.current = currentSpeaker;
  pairRef.current = activeConversationPair;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const container = containerRef.current!;

    let width = 0;
    let height = 0;

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      width = rect.width;
      height = rect.height;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    observer.observe(container);

    function frame() {
      if (width === 0 || height === 0) {
        rafRef.current = requestAnimationFrame(frame);
        return;
      }

      const now = Date.now();
      const snap = getSnapshotRef.current();
      const speaker = speakerRef.current;
      const pair = pairRef.current;

      ctx.clearRect(0, 0, width, height);

      // Compute tile size (square tiles, centered)
      const tileW = width / GRID_WIDTH;
      const tileH = height / GRID_HEIGHT;
      const tileSize = Math.min(tileW, tileH);
      const offsetX = (width - tileSize * GRID_WIDTH) / 2;
      const offsetY = (height - tileSize * GRID_HEIGHT) / 2;

      // Background
      ctx.fillStyle = "#0f1923";
      ctx.fillRect(0, 0, width, height);

      // Grid area background
      ctx.fillStyle = "#141e2b";
      ctx.fillRect(
        offsetX,
        offsetY,
        tileSize * GRID_WIDTH,
        tileSize * GRID_HEIGHT
      );

      // Subtle grid lines
      ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= GRID_WIDTH; x++) {
        ctx.beginPath();
        ctx.moveTo(offsetX + x * tileSize, offsetY);
        ctx.lineTo(offsetX + x * tileSize, offsetY + GRID_HEIGHT * tileSize);
        ctx.stroke();
      }
      for (let y = 0; y <= GRID_HEIGHT; y++) {
        ctx.beginPath();
        ctx.moveTo(offsetX, offsetY + y * tileSize);
        ctx.lineTo(offsetX + GRID_WIDTH * tileSize, offsetY + y * tileSize);
        ctx.stroke();
      }

      // Waypoints
      for (const wp of snap.waypoints) {
        const wx = offsetX + (wp.position.x + 0.5) * tileSize;
        const wy = offsetY + (wp.position.y + 0.5) * tileSize;

        // Small diamond marker
        const s = tileSize * 0.15;
        ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
        ctx.beginPath();
        ctx.moveTo(wx, wy - s);
        ctx.lineTo(wx + s, wy);
        ctx.lineTo(wx, wy + s);
        ctx.lineTo(wx - s, wy);
        ctx.closePath();
        ctx.fill();

        // Label
        ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
        ctx.font = `${Math.max(9, tileSize * 0.3)}px "SF Mono", "Fira Code", monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(wp.name, wx, wy + s + 4);
      }

      // Conversation line between pair
      if (pair) {
        const aSpatial = snap.npcs.find((n) => n.npcId === pair[0]);
        const bSpatial = snap.npcs.find((n) => n.npcId === pair[1]);
        if (aSpatial && bSpatial) {
          const ax =
            offsetX + (lerpX(aSpatial, now, snap.tickIntervalMs) + 0.5) * tileSize;
          const ay =
            offsetY + (lerpY(aSpatial, now, snap.tickIntervalMs) + 0.5) * tileSize;
          const bx =
            offsetX + (lerpX(bSpatial, now, snap.tickIntervalMs) + 0.5) * tileSize;
          const by =
            offsetY + (lerpY(bSpatial, now, snap.tickIntervalMs) + 0.5) * tileSize;

          ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // NPCs (sorted by Y for pseudo-depth)
      const sortedNpcs = [...snap.npcs].sort(
        (a, b) =>
          lerpY(a, now, snap.tickIntervalMs) -
          lerpY(b, now, snap.tickIntervalMs)
      );

      for (const spatial of sortedNpcs) {
        const npc = getNpcRef.current(spatial.npcId);
        if (!npc) continue;

        const px =
          offsetX +
          (lerpX(spatial, now, snap.tickIntervalMs) + 0.5) * tileSize;
        const py =
          offsetY +
          (lerpY(spatial, now, snap.tickIntervalMs) + 0.5) * tileSize;

        const radius = tileSize * 0.38;
        const isSpeaking = speaker === spatial.npcId;
        const isFrozen = spatial.frozen;

        // Glow when in conversation
        if (isFrozen) {
          ctx.beginPath();
          ctx.arc(px, py, radius + 6, 0, Math.PI * 2);
          const pulse = 0.15 + 0.1 * Math.sin(now / 400);
          ctx.fillStyle = npc.color + Math.round(pulse * 255).toString(16).padStart(2, "0");
          ctx.fill();
        }

        // Shadow
        ctx.beginPath();
        ctx.ellipse(px, py + radius + 4, radius * 0.7, radius * 0.2, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
        ctx.fill();

        // Body circle
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fillStyle = "#1a1a2e";
        ctx.fill();
        ctx.strokeStyle = npc.color;
        ctx.lineWidth = isSpeaking ? 3 : 2;
        ctx.stroke();

        // Emoji avatar
        ctx.font = `${tileSize * 0.45}px serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(npc.avatar, px, py);

        // Name label
        ctx.fillStyle = npc.color;
        ctx.font = `bold ${Math.max(10, tileSize * 0.3)}px "SF Mono", "Fira Code", monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(npc.name, px, py + radius + 8);

        // Thinking dots when speaking
        if (isSpeaking) {
          const dotY = py - radius - 14;
          const dotSpacing = 6;
          for (let d = 0; d < 3; d++) {
            const dotX = px + (d - 1) * dotSpacing;
            const phase = Math.sin(now / 300 + d * 0.8);
            const dotRadius = 2 + phase * 0.8;
            const alpha = 0.4 + phase * 0.3;
            ctx.beginPath();
            ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.fill();
          }
        }

        // Destination indicator (subtle line to where they're heading)
        if (spatial.destination && !isFrozen) {
          const dx =
            offsetX +
            (spatial.destination.position.x + 0.5) * tileSize;
          const dy =
            offsetY +
            (spatial.destination.position.y + 0.5) * tileSize;

          ctx.strokeStyle = npc.color + "15";
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 6]);
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(dx, dy);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div ref={containerRef} className="scene">
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
}
