import { useEffect, useRef, useCallback } from "react";
import type { NPC } from "../types";
import type { NpcSnapshot } from "./SidePanel";

interface CharacterViewerProps {
  npcs: NPC[];
  selectedNpcId: string | null;
  onSelectNpc: (id: string | null) => void;
  npcHistory: Record<string, NpcSnapshot[]>;
}

const EMOTION_COLORS: Record<string, string> = {
  anger: "#e53935",
  trust: "#42a5f5",
  fear: "#ab47bc",
  joy: "#fdd835",
};

function relationshipLabel(value: number): string {
  if (value >= 0.6) return "close";
  if (value >= 0.2) return "friendly";
  if (value > -0.2) return "neutral";
  if (value > -0.6) return "wary";
  return "hostile";
}

function Sparkline({
  data,
  color,
  width = 120,
  height = 24,
}: {
  data: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const padding = 2;
    const drawWidth = width - padding * 2;
    const drawHeight = height - padding * 2;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.beginPath();

    const step = data.length > 1 ? drawWidth / (data.length - 1) : 0;
    data.forEach((val, i) => {
      const x = padding + i * step;
      const y = padding + drawHeight * (1 - val);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Draw last point dot
    if (data.length > 0) {
      const lastVal = data[data.length - 1];
      const lastX = padding + (data.length - 1) * step;
      const lastY = padding + drawHeight * (1 - lastVal);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(lastX, lastY, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [data, color, width, height]);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, display: "block" }}
    />
  );
}

export function CharacterViewer({
  npcs,
  selectedNpcId,
  onSelectNpc,
  npcHistory,
}: CharacterViewerProps) {
  const npcMap = Object.fromEntries(npcs.map((n) => [n.id, n]));
  const selected = selectedNpcId ? npcMap[selectedNpcId] : null;
  const history = selectedNpcId ? npcHistory[selectedNpcId] ?? [] : [];

  return (
    <div className="character-viewer">
      <div className="npc-selector">
        {npcs.map((npc) => (
          <button
            key={npc.id}
            className={`npc-chip${selectedNpcId === npc.id ? " selected" : ""}`}
            style={{ borderColor: npc.color }}
            onClick={() => onSelectNpc(npc.id === selectedNpcId ? null : npc.id)}
          >
            <span className="npc-chip-avatar">{npc.avatar}</span>
            <span className="npc-chip-name">{npc.name}</span>
          </button>
        ))}
      </div>

      {selected ? (
        <div className="npc-detail">
          <div className="npc-header">
            <span className="npc-detail-avatar">{selected.avatar}</span>
            <div className="npc-header-info">
              <h3 className="npc-detail-name" style={{ color: selected.color }}>
                {selected.name}
              </h3>
              <div className="npc-traits">
                {selected.personalityTraits.map((trait) => (
                  <span key={trait} className="trait-chip">
                    {trait}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="npc-section">
            <div className="section-label">Core Desires</div>
            <ul className="desires-list">
              {selected.coreDesires.map((desire) => (
                <li key={desire}>{desire}</li>
              ))}
            </ul>
          </div>

          <div className="npc-section">
            <div className="section-label">Emotional State</div>
            <div className="emotion-bars">
              {(["anger", "trust", "fear", "joy"] as const).map((emotion) => {
                const value = selected.emotionalState[emotion];
                const historyData = history.map((s) => s.emotions[emotion]);
                return (
                  <div key={emotion} className="emotion-row">
                    <span className="emotion-label">{emotion}</span>
                    <div className="emotion-bar-track">
                      <div
                        className="emotion-bar-fill"
                        style={{
                          width: `${value * 100}%`,
                          background: EMOTION_COLORS[emotion],
                        }}
                      />
                    </div>
                    <span className="emotion-value">{value.toFixed(2)}</span>
                    {historyData.length > 1 && (
                      <Sparkline data={historyData} color={EMOTION_COLORS[emotion]} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="npc-section">
            <div className="section-label">Relationships</div>
            <div className="relationship-list">
              {Object.entries(selected.relationships).length === 0 && (
                <div className="empty-state">No relationships yet</div>
              )}
              {Object.entries(selected.relationships).map(([otherId, value]) => {
                const other = npcMap[otherId];
                if (!other) return null;
                const pct = ((value + 1) / 2) * 100;
                const barColor = value >= 0 ? "#4caf50" : "#e53935";
                return (
                  <div key={otherId} className="relationship-row">
                    <span className="rel-npc">
                      {other.avatar} {other.name}
                    </span>
                    <div className="rel-bar-track">
                      <div className="rel-bar-midline" />
                      <div
                        className="rel-bar-fill"
                        style={{
                          left: value >= 0 ? "50%" : `${pct}%`,
                          width: `${Math.abs(value) * 50}%`,
                          background: barColor,
                        }}
                      />
                    </div>
                    <span className="rel-value">{value.toFixed(2)}</span>
                    <span className="rel-label">{relationshipLabel(value)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {selected.secrets.length > 0 && (
            <div className="npc-section">
              <div className="section-label">Secrets</div>
              <div className="secrets-list">
                {selected.secrets.map((secret, i) => {
                  const knownBy = npcs.filter(
                    (n) =>
                      n.id !== selected.id &&
                      n.knownSecrets[selected.id]?.includes(secret)
                  );
                  return (
                    <div key={i} className="secret-entry">
                      <span className="secret-text">{secret}</span>
                      {knownBy.length > 0 && (
                        <span className="secret-known-by">
                          Known by: {knownBy.map((n) => n.name).join(", ")}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="npc-section">
            <div className="section-label">Recent Memories</div>
            <div className="memory-list">
              {selected.shortTermMemory.length === 0 && (
                <div className="empty-state">No memories yet</div>
              )}
              {selected.shortTermMemory
                .slice(-5)
                .reverse()
                .map((mem, i) => (
                  <div key={i} className="memory-entry">
                    {mem.type && (
                      <span className={`memory-type-badge memory-type-${mem.type}`}>
                        {mem.type}
                      </span>
                    )}
                    <span className="memory-time">
                      {new Date(mem.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="memory-text">
                      {mem.text.length > 120 ? mem.text.slice(0, 120) + "..." : mem.text}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="npc-detail-empty">
          Select an NPC above to inspect their state
        </div>
      )}
    </div>
  );
}
