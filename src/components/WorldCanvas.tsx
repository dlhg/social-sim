import { useEffect, useRef } from "react";
import type { NPC, BubbleData, FloaterData, DayPhase } from "../types";
import type { WorldSnapshot, NpcSpatialState } from "../types";
import { SpriteSystem } from "../sprite-system";
import { TilemapRenderer } from "../tilemap-renderer";

interface WorldCanvasProps {
  getSnapshot: () => WorldSnapshot;
  getNpc: (id: string) => NPC | undefined;
  currentSpeaker: string | null;
  activeConversationPair: [string, string] | null;
  bubbles: BubbleData[];
  floaters: FloaterData[];
  dayPhase: DayPhase;
  onNpcClick?: (npcId: string) => void;
  tilemap: TilemapRenderer;
  cameraMode: "auto" | "free";
}

// Time-of-day color tints (subtle overlays on canvas)
const PHASE_TINTS: Record<DayPhase, { bg: string; grid: string; tintColor: string; tintAlpha: number }> = {
  morning: { bg: "#141a22", grid: "#1a2230", tintColor: "180, 160, 100", tintAlpha: 0.04 },
  afternoon: { bg: "#161e2a", grid: "#1c2636", tintColor: "200, 200, 200", tintAlpha: 0 },
  evening: { bg: "#10141e", grid: "#161c28", tintColor: "80, 100, 180", tintAlpha: 0.06 },
};

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

// ── Camera state for smooth pan/zoom ──────────
interface CameraState {
  // Current interpolated values
  cx: number;  // center X in grid coords
  cy: number;  // center Y in grid coords
  zoom: number;
  // Targets
  targetCx: number;
  targetCy: number;
  targetZoom: number;
  // Dimming
  dimAmount: number;       // 0 = no dim, 1 = full dim
  targetDimAmount: number;
}

const CAMERA_LERP_SPEED = 0.03;  // per frame (~60fps)
const DEFAULT_ZOOM = 1.5;
const FOCUS_ZOOM = 3.5;
const FOCUS_ZOOM_MIN = 2.5;
const DIM_OPACITY = 0.35;

const FREE_CAM_SPEED = 0.5; // grid tiles per frame
const FREE_CAM_ZOOM_STEP = 0.15;
const FREE_CAM_ZOOM_MIN = 0.5;
const FREE_CAM_ZOOM_MAX = 5.0;

export function WorldCanvas({
  getSnapshot,
  getNpc,
  currentSpeaker,
  activeConversationPair,
  bubbles,
  floaters,
  dayPhase,
  onNpcClick,
  tilemap,
  cameraMode,
}: WorldCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const spritesRef = useRef(new SpriteSystem());
  const bubbleRefsMap = useRef(new Map<string, HTMLDivElement>());
  const bubbleSizeCache = useRef(new Map<string, { w: number; h: number }>());
  const bubbleResizeObserver = useRef<ResizeObserver | null>(null);
  const floaterRefsMap = useRef(new Map<string, HTMLDivElement>());
  const npcScreenPositions = useRef<{ npcId: string; x: number; y: number; radius: number }[]>([]);
  const onNpcClickRef = useRef(onNpcClick);
  onNpcClickRef.current = onNpcClick;
  const cameraModeRef = useRef(cameraMode);
  cameraModeRef.current = cameraMode;
  const keysDown = useRef(new Set<string>());

  // Store props in refs so the rAF loop always reads fresh values
  const getSnapshotRef = useRef(getSnapshot);
  const getNpcRef = useRef(getNpc);
  const speakerRef = useRef(currentSpeaker);
  const pairRef = useRef(activeConversationPair);
  const bubblesRef = useRef(bubbles);
  const floatersRef = useRef(floaters);
  const dayPhaseRef = useRef(dayPhase);
  const tilemapRef = useRef(tilemap);

  getSnapshotRef.current = getSnapshot;
  getNpcRef.current = getNpc;
  speakerRef.current = currentSpeaker;
  pairRef.current = activeConversationPair;
  bubblesRef.current = bubbles;
  floatersRef.current = floaters;
  dayPhaseRef.current = dayPhase;
  tilemapRef.current = tilemap;

  const cameraRef = useRef<CameraState>({
    cx: tilemap.mapWidth / 2,
    cy: tilemap.mapHeight / 2,
    zoom: DEFAULT_ZOOM,
    targetCx: tilemap.mapWidth / 2,
    targetCy: tilemap.mapHeight / 2,
    targetZoom: DEFAULT_ZOOM,
    dimAmount: 0,
    targetDimAmount: 0,
  });
  const freeCamZoomRef = useRef(DEFAULT_ZOOM);

  useEffect(() => {
    spritesRef.current.load(); // fire-and-forget; draw loop checks .ready

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

    // Observe bubble element sizes so the rAF loop never reads offsetWidth/Height
    const bubbleRO = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const npcId = el.dataset.npcId;
        if (npcId) {
          bubbleSizeCache.current.set(npcId, {
            w: entry.contentBoxSize?.[0]?.inlineSize ?? el.offsetWidth,
            h: entry.contentBoxSize?.[0]?.blockSize ?? el.offsetHeight,
          });
        }
      }
    });
    bubbleResizeObserver.current = bubbleRO;

    // Arrow key + zoom listeners for free cam
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        keysDown.current.add(e.key);
      }
      if (cameraModeRef.current === "free") {
        if (e.key === "=" || e.key === "+") {
          freeCamZoomRef.current = Math.min(FREE_CAM_ZOOM_MAX, freeCamZoomRef.current + FREE_CAM_ZOOM_STEP);
        } else if (e.key === "-") {
          freeCamZoomRef.current = Math.max(FREE_CAM_ZOOM_MIN, freeCamZoomRef.current - FREE_CAM_ZOOM_STEP);
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysDown.current.delete(e.key);
    };
    const handleWheel = (e: WheelEvent) => {
      if (cameraModeRef.current !== "free") return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -FREE_CAM_ZOOM_STEP : FREE_CAM_ZOOM_STEP;
      freeCamZoomRef.current = Math.max(FREE_CAM_ZOOM_MIN, Math.min(FREE_CAM_ZOOM_MAX, freeCamZoomRef.current + delta));
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    function frame() {
      if (width === 0 || height === 0) {
        rafRef.current = requestAnimationFrame(frame);
        return;
      }

      const now = Date.now();
      const snap = getSnapshotRef.current();
      const speaker = speakerRef.current;
      const pair = pairRef.current;
      const cam = cameraRef.current;

      // ── Update camera target ──────────────────
      if (cameraModeRef.current === "free") {
        // Free cam: arrow keys move, +/-/scroll to zoom
        const keys = keysDown.current;
        if (keys.has("ArrowUp")) cam.targetCy -= FREE_CAM_SPEED;
        if (keys.has("ArrowDown")) cam.targetCy += FREE_CAM_SPEED;
        if (keys.has("ArrowLeft")) cam.targetCx -= FREE_CAM_SPEED;
        if (keys.has("ArrowRight")) cam.targetCx += FREE_CAM_SPEED;
        cam.targetZoom = freeCamZoomRef.current;
        cam.targetDimAmount = 0;
      } else if (pair) {
        const aSpatial = snap.npcs.find((n) => n.npcId === pair[0]);
        const bSpatial = snap.npcs.find((n) => n.npcId === pair[1]);
        if (aSpatial && bSpatial) {
          const ax = lerpX(aSpatial, now, snap.tickIntervalMs);
          const ay = lerpY(aSpatial, now, snap.tickIntervalMs);
          const bx = lerpX(bSpatial, now, snap.tickIntervalMs);
          const by = lerpY(bSpatial, now, snap.tickIntervalMs);
          cam.targetCx = (ax + bx) / 2 + 0.5;
          cam.targetCy = (ay + by) / 2 + 0.5;
          // Zoom more when NPCs are close, less when far apart
          const dist = Math.hypot(bx - ax, by - ay);
          const zoomForDist = Math.max(FOCUS_ZOOM_MIN, FOCUS_ZOOM - dist * 0.05);
          cam.targetZoom = zoomForDist;
          cam.targetDimAmount = 1;
        }
      } else {
        cam.targetCx = tilemapRef.current.mapWidth / 2;
        cam.targetCy = tilemapRef.current.mapHeight / 2;
        cam.targetZoom = DEFAULT_ZOOM;
        cam.targetDimAmount = 0;
      }

      // ── Smoothly interpolate camera ───────────
      cam.cx += (cam.targetCx - cam.cx) * CAMERA_LERP_SPEED;
      cam.cy += (cam.targetCy - cam.cy) * CAMERA_LERP_SPEED;
      cam.zoom += (cam.targetZoom - cam.zoom) * CAMERA_LERP_SPEED;
      cam.dimAmount += (cam.targetDimAmount - cam.dimAmount) * CAMERA_LERP_SPEED;

      ctx.clearRect(0, 0, width, height);

      // Compute tile size (square tiles, centered) at zoom=1
      const gridW = tilemap.mapWidth || 72;
      const gridH = tilemap.mapHeight || 48;
      const tileW = width / gridW;
      const tileH = height / gridH;
      const baseTileSize = Math.min(tileW, tileH);

      // Apply camera transform
      const tileSize = baseTileSize * cam.zoom;
      // Camera center in pixel space (where cam.cx,cam.cy should map to screen center)
      const camPixelX = cam.cx * tileSize;
      const camPixelY = cam.cy * tileSize;
      const offsetX = width / 2 - camPixelX;
      const offsetY = height / 2 - camPixelY;

      // Time-of-day tinting
      const phaseTint = PHASE_TINTS[dayPhaseRef.current];

      // Background
      ctx.fillStyle = phaseTint.bg;
      ctx.fillRect(0, 0, width, height);

      const tm = tilemapRef.current;

      if (tm.ready) {
        // Tilemap replaces the flat grid background
        tm.drawGround(ctx, offsetX, offsetY, tileSize);
        tm.drawObjects(ctx, offsetX, offsetY, tileSize);

        // Phase tint overlay on top of tilemap
        if (phaseTint.tintAlpha > 0) {
          ctx.fillStyle = `rgba(${phaseTint.tintColor}, ${phaseTint.tintAlpha})`;
          ctx.fillRect(
            offsetX,
            offsetY,
            tileSize * gridW,
            tileSize * gridH
          );
        }
      } else {
        // Fallback: flat grid while tilemap loads
        ctx.fillStyle = phaseTint.grid;
        ctx.fillRect(
          offsetX,
          offsetY,
          tileSize * gridW,
          tileSize * gridH
        );
      }

      // Dim the environment during conversations
      const envAlpha = 1 - cam.dimAmount * 0.6;
      ctx.globalAlpha = envAlpha;


      // Waypoints
      const wpFont = `500 ${Math.max(9, tileSize * 0.28)}px "Inter", -apple-system, sans-serif`;
      ctx.font = wpFont;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (const wp of snap.waypoints) {
        const wx = offsetX + (wp.position.x + 0.5) * tileSize;
        const wy = offsetY + (wp.position.y + 0.5) * tileSize;

        // Small diamond marker
        const s = tileSize * 0.12;
        ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
        ctx.beginPath();
        ctx.moveTo(wx, wy - s);
        ctx.lineTo(wx + s, wy);
        ctx.lineTo(wx, wy + s);
        ctx.lineTo(wx - s, wy);
        ctx.closePath();
        ctx.fill();

        // Label
        ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
        ctx.fillText(wp.name, wx, wy + s + 5);
      }

      ctx.globalAlpha = 1;

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

      const framePositions: { npcId: string; x: number; y: number; radius: number }[] = [];

      for (const spatial of sortedNpcs) {
        const npc = getNpcRef.current(spatial.npcId);
        if (!npc) continue;

        const px =
          offsetX +
          (lerpX(spatial, now, snap.tickIntervalMs) + 0.5) * tileSize;
        const py =
          offsetY +
          (lerpY(spatial, now, snap.tickIntervalMs) + 0.5) * tileSize;

        const isSpeaking = speaker === spatial.npcId;
        const isFrozen = spatial.frozen;

        // Dim non-conversing NPCs when a conversation is active
        const isInConversation = pair && (spatial.npcId === pair[0] || spatial.npcId === pair[1]);
        const npcAlpha = isInConversation || cam.dimAmount < 0.01
          ? 1
          : 1 - cam.dimAmount * (1 - DIM_OPACITY);
        ctx.globalAlpha = npcAlpha;

        // Movement detection for sprite animation
        let moveDx = spatial.position.x - spatial.previousPosition.x;
        let moveDy = spatial.position.y - spatial.previousPosition.y;
        const t = lerpFactor(spatial, now, snap.tickIntervalMs);
        const isMoving = (moveDx !== 0 || moveDy !== 0) && !isFrozen && t < 1.0;

        // Face conversation partner when in a conversation
        if (isInConversation && pair) {
          const partnerId = spatial.npcId === pair[0] ? pair[1] : pair[0];
          const partnerSpatial = snap.npcs.find((n) => n.npcId === partnerId);
          if (partnerSpatial) {
            const faceDx = partnerSpatial.position.x - spatial.position.x;
            const faceDy = partnerSpatial.position.y - spatial.position.y;
            // Pass facing delta so the sprite system updates direction
            moveDx = faceDx;
            moveDy = faceDy;
          }
        }

        // Sprite dimensions (1 tile wide, 2 tiles tall, 1:2 aspect)
        const sprW = tileSize * 1.0;
        const sprH = tileSize * 2.0;
        const feetY = py + tileSize * 0.35;

        // Glow when in conversation
        if (isFrozen) {
          ctx.beginPath();
          ctx.arc(px, feetY - sprH * 0.4, sprH * 0.3, 0, Math.PI * 2);
          const pulse = 0.12 + 0.08 * Math.sin(now / 400);
          ctx.fillStyle = npc.color + Math.round(pulse * 255).toString(16).padStart(2, "0");
          ctx.fill();
        }

        // Shadow at feet
        ctx.beginPath();
        ctx.ellipse(px, feetY, sprW * 0.35, sprW * 0.1, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
        ctx.fill();

        // Try sprite, fall back to circle + emoji
        const npcForSprite = getNpc(spatial.npcId);
        const drew = spritesRef.current.draw(
          ctx, spatial.npcId, px, feetY, sprW, sprH,
          moveDx, moveDy, isMoving, now, npcForSprite?.spriteId,
        );

        if (!drew) {
          const radius = tileSize * 0.38;
          ctx.beginPath();
          ctx.arc(px, py, radius, 0, Math.PI * 2);
          ctx.fillStyle = "#1e1e30";
          ctx.fill();
          ctx.strokeStyle = npc.color;
          ctx.lineWidth = isSpeaking ? 3 : 2;
          ctx.stroke();

          ctx.font = `${tileSize * 0.45}px serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(npc.avatar, px, py);
        }

        // Name label
        ctx.fillStyle = npc.color;
        ctx.font = `600 ${Math.max(10, tileSize * 0.28)}px "Inter", -apple-system, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(npc.name, px, feetY + 4);

        // Position bubble overlay element (if one exists for this NPC)
        const bubbleEl = bubbleRefsMap.current.get(spatial.npcId);
        if (bubbleEl) {
          const aboveAnchorY = feetY - sprH - 8;
          const cached = bubbleSizeCache.current.get(spatial.npcId);
          const bubbleHeight = cached?.h || 60;
          const bubbleWidth = cached?.w || 200;
          // Clamp x so the bubble stays within the canvas bounds
          const halfBubble = bubbleWidth / 2;
          const clampedPx = Math.max(halfBubble, Math.min(width - halfBubble, px));
          // If the bubble would be clipped at the top, flip it below the NPC
          if (aboveAnchorY - bubbleHeight < 0) {
            const belowAnchorY = feetY + 20;
            bubbleEl.style.transform = `translate(${clampedPx}px, ${belowAnchorY}px) translate(-50%, 0%)`;
            bubbleEl.classList.add("bubble-flipped");
          } else {
            bubbleEl.style.transform = `translate(${clampedPx}px, ${aboveAnchorY}px) translate(-50%, -100%)`;
            bubbleEl.classList.remove("bubble-flipped");
          }
          const depthZ = Math.floor(lerpY(spatial, now, snap.tickIntervalMs) * 10);
          bubbleEl.style.zIndex = String(isSpeaking ? 10000 : depthZ);
          bubbleEl.style.opacity = String(npcAlpha);
        }

        // Destination indicator
        if (spatial.destination && !isFrozen) {
          const destX =
            offsetX +
            (spatial.destination.position.x + 0.5) * tileSize;
          const destY =
            offsetY +
            (spatial.destination.position.y + 0.5) * tileSize;

          ctx.strokeStyle = npc.color + "15";
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 6]);
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(destX, destY);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Track screen position for click hit-testing
        framePositions.push({ npcId: spatial.npcId, x: px, y: feetY - sprH * 0.5, radius: sprW * 0.6 });

        ctx.globalAlpha = 1;
      }

      npcScreenPositions.current = framePositions;

      // Position floater elements at NPC's side, drifting outward
      for (const floater of floatersRef.current) {
        const floaterEl = floaterRefsMap.current.get(floater.id);
        if (!floaterEl) continue;
        const spatial = snap.npcs.find(n => n.npcId === floater.npcId);
        if (!spatial) continue;

        const fx = offsetX + (lerpX(spatial, now, snap.tickIntervalMs) + 0.5) * tileSize;
        const fy = offsetY + (lerpY(spatial, now, snap.tickIntervalMs) + 0.5) * tileSize;
        // Start at the sprite's side, roughly shoulder height
        let startX = fx + floater.directionX * tileSize * 0.5;
        const startY = fy - tileSize * 0.3 + floater.offsetY;
        // Clamp so floaters stay within canvas bounds
        startX = Math.max(0, Math.min(width, startX));
        floaterEl.style.transform = `translate(${startX}px, ${startY}px)`;
      }

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      observer.disconnect();
      bubbleRO.disconnect();
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, []);

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (!onNpcClickRef.current) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // Find closest NPC within hit radius
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const pos of npcScreenPositions.current) {
      const d = Math.hypot(mx - pos.x, my - pos.y);
      if (d < pos.radius && d < bestDist) {
        bestDist = d;
        bestId = pos.npcId;
      }
    }
    if (bestId) onNpcClickRef.current(bestId);
  };

  return (
    <div ref={containerRef} className="scene" onClick={handleCanvasClick}>
      <canvas ref={canvasRef} style={{ display: "block" }} />
      <div className="bubble-overlay">
        {bubbles.map((b) => {
          const npc = getNpc(b.npcId);
          return (
            <div
              key={`${b.npcId}-${b.type}`}
              data-npc-id={b.npcId}
              ref={(el) => {
                const prev = bubbleRefsMap.current.get(b.npcId);
                if (el) {
                  bubbleRefsMap.current.set(b.npcId, el);
                  bubbleResizeObserver.current?.observe(el);
                } else {
                  if (prev) bubbleResizeObserver.current?.unobserve(prev);
                  bubbleRefsMap.current.delete(b.npcId);
                  bubbleSizeCache.current.delete(b.npcId);
                }
              }}
              className={`bubble bubble-${b.type}${b.completedAt ? " bubble-fading" : ""}`}
              style={{ "--bubble-color": npc?.color ?? "#6ec6ff" } as React.CSSProperties}
            >
              <span className="bubble-name" style={{ color: npc?.color }}>
                {npc?.name}
              </span>
              <span className="bubble-text">{b.text}</span>
              {!b.completedAt && b.type === "speech" && (
                <span className="bubble-cursor">|</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="floater-overlay">
        {floaters.map((f) => (
          <div
            key={f.id}
            ref={(el) => {
              if (el) floaterRefsMap.current.set(f.id, el);
              else floaterRefsMap.current.delete(f.id);
            }}
            className="floater-anchor"
            style={{
              "--dir": f.directionX,
              "--drift": f.driftScale,
            } as React.CSSProperties}
          >
            <span
              className={`floater floater-${f.category}`}
              style={{
                "--floater-color": f.color,
                animationDelay: `${f.delay}ms`,
                textAlign: f.directionX > 0 ? "left" : "right",
              } as React.CSSProperties}
            >
              {f.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
