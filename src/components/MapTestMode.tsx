import { useEffect, useRef, useState } from "react";
import { TilemapRenderer } from "../tilemap-renderer";
import { SpriteSystem } from "../sprite-system";

interface MapTestModeProps {
  onExit: () => void;
}

const GRID_WIDTH = 72;
const GRID_HEIGHT = 48;
const MOVE_INTERVAL = 120; // ms between moves when holding key

export function MapTestMode({ onExit }: MapTestModeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const tilemapRef = useRef(new TilemapRenderer());
  const spritesRef = useRef(new SpriteSystem());

  // Player state
  const playerRef = useRef({ x: 10, y: 10, lastDx: 0, lastDy: 1 });
  const keysRef = useRef(new Set<string>());
  const lastMoveRef = useRef(0);
  const [info, setInfo] = useState("");

  useEffect(() => {
    const tilemap = tilemapRef.current;
    const sprites = spritesRef.current;

    sprites.load();
    tilemap.load("/assets/levels/testmap.tmj").then(() => {
      // Start player at first waypoint if available
      if (tilemap.waypoints.length > 0) {
        const wp = tilemap.waypoints[0];
        playerRef.current.x = wp.position.x;
        playerRef.current.y = wp.position.y;
      }
    });

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

    // Input
    const onKeyDown = (e: KeyboardEvent) => {
      keysRef.current.add(e.key);
      if (e.key === "Escape") onExit();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    function processMovement(now: number) {
      if (now - lastMoveRef.current < MOVE_INTERVAL) return;

      const keys = keysRef.current;
      let dx = 0;
      let dy = 0;
      if (keys.has("ArrowUp") || keys.has("w") || keys.has("W")) dy = -1;
      if (keys.has("ArrowDown") || keys.has("s") || keys.has("S")) dy = 1;
      if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) dx = -1;
      if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) dx = 1;

      if (dx === 0 && dy === 0) return;

      const p = playerRef.current;
      const newX = p.x + dx;
      const newY = p.y + dy;

      // Bounds check
      if (newX < 0 || newX >= GRID_WIDTH || newY < 0 || newY >= GRID_HEIGHT) return;

      // Collision check
      const tilemap = tilemapRef.current;
      if (tilemap.ready && tilemap.collisionGrid.length > 0) {
        const idx = newY * GRID_WIDTH + newX;
        if (tilemap.collisionGrid[idx]) {
          setInfo(`Blocked at (${newX}, ${newY})`);
          p.lastDx = dx;
          p.lastDy = dy;
          lastMoveRef.current = now;
          return;
        }
      }

      p.x = newX;
      p.y = newY;
      p.lastDx = dx;
      p.lastDy = dy;
      lastMoveRef.current = now;

      // Show nearby waypoint
      if (tilemap.ready) {
        const nearWp = tilemap.waypoints.find(
          wp => Math.abs(wp.position.x - newX) + Math.abs(wp.position.y - newY) <= 3
        );
        setInfo(nearWp
          ? `(${newX}, ${newY}) near "${nearWp.name}" [${nearWp.mood}]`
          : `(${newX}, ${newY})`
        );
      }
    }

    function frame() {
      if (width === 0 || height === 0) {
        rafRef.current = requestAnimationFrame(frame);
        return;
      }

      const now = Date.now();
      processMovement(now);

      const tilemap = tilemapRef.current;
      const player = playerRef.current;

      // Camera follows player
      const tileW = width / GRID_WIDTH;
      const tileH = height / GRID_HEIGHT;
      const tileSize = Math.min(tileW, tileH) * 2.5;

      const camX = width / 2 - (player.x + 0.5) * tileSize;
      const camY = height / 2 - (player.y + 0.5) * tileSize;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#141a22";
      ctx.fillRect(0, 0, width, height);

      if (tilemap.ready) {
        tilemap.drawGround(ctx, camX, camY, tileSize);
        tilemap.drawObjects(ctx, camX, camY, tileSize);

        // Draw collision overlay (subtle red tint on blocked tiles)
        if (tilemap.collisionGrid.length > 0) {
          ctx.fillStyle = "rgba(255, 0, 0, 0.15)";
          for (let row = 0; row < GRID_HEIGHT; row++) {
            for (let col = 0; col < GRID_WIDTH; col++) {
              if (tilemap.collisionGrid[row * GRID_WIDTH + col]) {
                const sx = camX + col * tileSize;
                const sy = camY + row * tileSize;
                // Only draw if on screen
                if (sx + tileSize > 0 && sx < width && sy + tileSize > 0 && sy < height) {
                  ctx.fillRect(sx, sy, tileSize, tileSize);
                }
              }
            }
          }
        }

        // Draw waypoint markers
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        for (const wp of tilemap.waypoints) {
          const wx = camX + (wp.position.x + 0.5) * tileSize;
          const wy = camY + (wp.position.y + 0.5) * tileSize;

          // Diamond
          const s = tileSize * 0.2;
          ctx.fillStyle = "rgba(100, 200, 255, 0.5)";
          ctx.beginPath();
          ctx.moveTo(wx, wy - s);
          ctx.lineTo(wx + s, wy);
          ctx.lineTo(wx, wy + s);
          ctx.lineTo(wx - s, wy);
          ctx.closePath();
          ctx.fill();

          // Label
          ctx.font = `600 ${Math.max(10, tileSize * 0.3)}px "Inter", sans-serif`;
          ctx.fillStyle = "rgba(100, 200, 255, 0.8)";
          ctx.fillText(wp.name, wx, wy - s - 4);
        }
      }

      // Draw player sprite
      const px = camX + (player.x + 0.5) * tileSize;
      const py = camY + (player.y + 0.5) * tileSize;
      const sprW = tileSize;
      const sprH = tileSize * 2;
      const feetY = py + tileSize * 0.35;

      const moving = keysRef.current.size > 0 && (
        keysRef.current.has("ArrowUp") || keysRef.current.has("ArrowDown") ||
        keysRef.current.has("ArrowLeft") || keysRef.current.has("ArrowRight") ||
        keysRef.current.has("w") || keysRef.current.has("W") ||
        keysRef.current.has("a") || keysRef.current.has("A") ||
        keysRef.current.has("s") || keysRef.current.has("S") ||
        keysRef.current.has("d") || keysRef.current.has("D")
      );

      // Shadow
      ctx.beginPath();
      ctx.ellipse(px, feetY, sprW * 0.35, sprW * 0.1, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
      ctx.fill();

      const drew = sprites.draw(
        ctx, "test_player", px, feetY, sprW, sprH,
        player.lastDx, player.lastDy, moving, now,
      );

      if (!drew) {
        // Fallback circle
        const radius = tileSize * 0.38;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fillStyle = "#1e1e30";
        ctx.fill();
        ctx.strokeStyle = "#6ec6ff";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = `${tileSize * 0.45}px serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#fff";
        ctx.fillText("🧪", px, py);
      }

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [onExit]);

  return (
    <div ref={containerRef} className="scene" style={{ position: "relative" }}>
      <canvas ref={canvasRef} style={{ display: "block" }} />
      <div style={{
        position: "absolute",
        top: 12,
        left: 12,
        background: "rgba(0,0,0,0.7)",
        color: "#fff",
        padding: "8px 14px",
        borderRadius: 6,
        fontSize: 13,
        fontFamily: "var(--font-ui)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}>
        <div style={{ fontWeight: 600 }}>Map Test Mode</div>
        <div style={{ opacity: 0.7 }}>WASD / Arrows to move</div>
        <div style={{ opacity: 0.7 }}>Red = collision tiles</div>
        <div style={{ opacity: 0.7 }}>ESC to exit</div>
        {info && <div style={{ color: "#6ec6ff" }}>{info}</div>}
      </div>
      <button
        onClick={onExit}
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          background: "rgba(0,0,0,0.7)",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: 6,
          padding: "6px 14px",
          cursor: "pointer",
          fontSize: 13,
          fontFamily: "var(--font-ui)",
        }}
      >
        Exit
      </button>
    </div>
  );
}
