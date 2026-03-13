import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { NPC, RelationshipState, EmotionalState } from "../types";
import type { NpcStore } from "../npc-store";

// ── Props ────────────────────────────────────────────────────────────
export interface RelationshipGraphProps {
  npcs: NPC[];
  store: NpcStore;
  onNpcClick?: (npcId: string) => void;
  onClose: () => void;
}

// ── Force simulation types ──────────────────────────────────────────
interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  name: string;
}

interface SimEdge {
  sourceId: string;
  targetId: string;
  regardAtoB: number;
  regardBtoA: number;
  affection: number;
  trust: number;
  familiarity: number;
}

// ── Mood-to-border-color mapping ────────────────────────────────────
const MOOD_BORDER_COLORS: Record<string, string> = {
  volatile: "#e53935",
  bitter: "#e53935",
  melancholy: "#42a5f5",
  euphoric: "#ffd700",
  paranoid: "#9c27b0",
  "guilt-ridden": "#808000",
  restless: "#ffeb3b",
};

// ── Color interpolation helpers ─────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`;
}

function lerpColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(
    ar + (br - ar) * t,
    ag + (bg - ag) * t,
    ab + (bb - ab) * t,
  );
}

/** Map regard (-1..1) to edge color: orange -> gray -> blue */
function regardToColor(regard: number): string {
  if (regard < 0) {
    // -1 -> orange, 0 -> gray
    return lerpColor("#ff9800", "#607d8b", 1 + regard);
  }
  // 0 -> gray, 1 -> blue
  return lerpColor("#607d8b", "#42a5f5", regard);
}

// ── Emotion key labels ──────────────────────────────────────────────
const EMOTION_KEYS: (keyof EmotionalState)[] = [
  "anger", "trust", "fear", "joy", "sadness", "curiosity", "guilt",
];

const EMOTION_COLORS: Record<keyof EmotionalState, string> = {
  anger: "#e53935",
  trust: "#43a047",
  fear: "#9c27b0",
  joy: "#fdd835",
  sadness: "#42a5f5",
  curiosity: "#ff9800",
  guilt: "#795548",
};

// ── Relationship axis labels ────────────────────────────────────────
const REL_AXIS_LABELS: Record<keyof RelationshipState, string> = {
  regard: "Regard",
  affection: "Affection",
  respect: "Respect",
  trust: "Trust",
  fear: "Fear",
  disgust: "Disgust",
  debt: "Debt",
  familiarity: "Familiarity",
};

const REL_AXES: (keyof RelationshipState)[] = [
  "regard", "affection", "respect", "trust", "fear", "disgust", "debt", "familiarity",
];

// ── Force simulation ────────────────────────────────────────────────
function runForceSimulation(
  nodes: SimNode[],
  edges: SimEdge[],
  width: number,
  height: number,
  iterations: number,
): void {
  const REPULSION = 8000;
  const SPRING_BASE = 0.005;
  const SPRING_FAMILIARITY_SCALE = 0.02;
  const REGARD_PUSH = 3000;
  const DAMPING = 0.85;
  const CENTER_PULL = 0.002;
  const cx = width / 2;
  const cy = height / 2;

  for (let iter = 0; iter < iterations; iter++) {
    const cooling = 1 - iter / iterations; // cool down toward end

    // Charge repulsion between all node pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; dist = 1; }
        const force = (REPULSION * cooling) / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    // Edge spring forces + regard-based attraction/repulsion
    for (const edge of edges) {
      const a = nodes.find(n => n.id === edge.sourceId);
      const b = nodes.find(n => n.id === edge.targetId);
      if (!a || !b) continue;

      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) dist = 1;

      // Spring pull proportional to familiarity
      const springK = SPRING_BASE + edge.familiarity * SPRING_FAMILIARITY_SCALE;
      const idealDist = 100 + (1 - edge.familiarity) * 100;
      const displacement = dist - idealDist;
      const springForce = springK * displacement * cooling;
      const sfx = (dx / dist) * springForce;
      const sfy = (dy / dist) * springForce;
      a.vx += sfx;
      a.vy += sfy;
      b.vx -= sfx;
      b.vy -= sfy;

      // Regard-based: high regard = attraction, low = repulsion
      const avgRegard = (edge.regardAtoB + edge.regardBtoA) / 2;
      if (avgRegard < -0.2) {
        // Push apart
        const pushForce = (REGARD_PUSH * Math.abs(avgRegard) * cooling) / (dist * dist);
        a.vx -= (dx / dist) * pushForce;
        a.vy -= (dy / dist) * pushForce;
        b.vx += (dx / dist) * pushForce;
        b.vy += (dy / dist) * pushForce;
      } else if (avgRegard > 0.2) {
        // Pull together slightly
        const pullForce = avgRegard * 0.3 * cooling;
        a.vx += (dx / dist) * pullForce;
        a.vy += (dy / dist) * pullForce;
        b.vx -= (dx / dist) * pullForce;
        b.vy -= (dy / dist) * pullForce;
      }
    }

    // Center pull
    for (const node of nodes) {
      node.vx += (cx - node.x) * CENTER_PULL * cooling;
      node.vy += (cy - node.y) * CENTER_PULL * cooling;
    }

    // Apply velocities + damping
    for (const node of nodes) {
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      node.x += node.vx;
      node.y += node.vy;

      // Keep within bounds with padding
      const pad = 40;
      node.x = Math.max(pad, Math.min(width - pad, node.x));
      node.y = Math.max(pad, Math.min(height - pad, node.y));
    }
  }
}

// ── Topology hash for change detection ──────────────────────────────
function computeTopologyHash(npcs: NPC[]): string {
  const parts: string[] = [];
  for (const npc of npcs) {
    for (const [targetId, rel] of Object.entries(npc.relationships)) {
      // Bucket regard to detect crossing +/-0.4 or sign flip
      const bucket = Math.round(rel.regard * 2.5); // ~5 buckets from -1 to 1
      parts.push(`${npc.id}:${targetId}:${bucket}`);
    }
  }
  return parts.sort().join("|");
}

// ── Component ───────────────────────────────────────────────────────
export function RelationshipGraph({ npcs, store, onNpcClick, onClose }: RelationshipGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const topoHashRef = useRef<string>("");
  const [tick, setTick] = useState(0);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null); // "srcId:tgtId"
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number; flipX: boolean; flipY: boolean }>({ x: 0, y: 0, flipX: false, flipY: false });
  const containerRef = useRef<HTMLDivElement>(null);

  // Graph dimensions (SVG viewbox)
  const WIDTH = 380;
  const HEIGHT = 360;

  // Build edges from NPC relationships
  const edges = useMemo((): SimEdge[] => {
    const edgeMap = new Map<string, SimEdge>();
    for (const npc of npcs) {
      for (const [targetId, rel] of Object.entries(npc.relationships)) {
        if (!npcs.find(n => n.id === targetId)) continue;
        const key = [npc.id, targetId].sort().join(":");
        if (!edgeMap.has(key)) {
          edgeMap.set(key, {
            sourceId: key.split(":")[0],
            targetId: key.split(":")[1],
            regardAtoB: 0,
            regardBtoA: 0,
            affection: 0,
            trust: 0,
            familiarity: 0,
          });
        }
        const edge = edgeMap.get(key)!;
        if (npc.id === edge.sourceId) {
          edge.regardAtoB = rel.regard;
          edge.affection = Math.max(edge.affection, rel.affection);
          edge.trust = Math.max(edge.trust, rel.trust);
          edge.familiarity = Math.max(edge.familiarity, rel.familiarity);
        } else {
          edge.regardBtoA = rel.regard;
          edge.affection = Math.max(edge.affection, rel.affection);
          edge.trust = Math.max(edge.trust, rel.trust);
          edge.familiarity = Math.max(edge.familiarity, rel.familiarity);
        }
      }
    }
    return Array.from(edgeMap.values());
  }, [npcs, tick]);

  // Count strong connections per NPC for node sizing
  const strongConnectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const npc of npcs) counts.set(npc.id, 0);
    for (const edge of edges) {
      const avgRegard = Math.abs(edge.regardAtoB + edge.regardBtoA) / 2;
      if (avgRegard > 0.3 || edge.familiarity > 0.4) {
        counts.set(edge.sourceId, (counts.get(edge.sourceId) || 0) + 1);
        counts.set(edge.targetId, (counts.get(edge.targetId) || 0) + 1);
      }
    }
    return counts;
  }, [npcs, edges]);

  // Run / re-run force simulation
  useEffect(() => {
    const newHash = computeTopologyHash(npcs);
    const needsRerun = newHash !== topoHashRef.current || nodesRef.current.length !== npcs.length;

    if (!needsRerun && nodesRef.current.length > 0) return;

    topoHashRef.current = newHash;

    // Initialize or reuse node positions
    const existingPositions = new Map(nodesRef.current.map(n => [n.id, { x: n.x, y: n.y }]));
    const simNodes: SimNode[] = npcs.map((npc) => {
      const existing = existingPositions.get(npc.id);
      const strongCount = strongConnectionCounts.get(npc.id) || 0;
      const radius = 20 + Math.min(strongCount, 5) * 2; // 20-30
      return {
        id: npc.id,
        x: existing?.x ?? WIDTH / 2 + (Math.random() - 0.5) * 200,
        y: existing?.y ?? HEIGHT / 2 + (Math.random() - 0.5) * 200,
        vx: 0,
        vy: 0,
        radius,
        color: npc.color,
        name: npc.name,
      };
    });

    runForceSimulation(simNodes, edges, WIDTH, HEIGHT, 200);
    nodesRef.current = simNodes;

    const posMap = new Map<string, { x: number; y: number }>();
    for (const node of simNodes) {
      posMap.set(node.id, { x: node.x, y: node.y });
    }
    setPositions(posMap);
  }, [npcs, edges, strongConnectionCounts]);

  // Throttled re-render of edge visuals every 500ms
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 500);
    return () => clearInterval(interval);
  }, []);

  // Edge rendering helpers
  const getEdgeStyle = useCallback((trust: number): string => {
    if (trust > 0.4) return ""; // solid
    if (trust >= 0.2) return "6 3"; // dashed
    return "2 2"; // dotted
  }, []);

  const getEdgeWidth = useCallback((regardAtoB: number, regardBtoA: number, affection: number): number => {
    const avgAbsRegard = (Math.abs(regardAtoB) + Math.abs(regardBtoA)) / 2;
    return 1 + (avgAbsRegard + affection) * 1.5; // 1-4px range
  }, []);

  // Arrow marker for asymmetric regard
  const renderArrow = useCallback((
    edge: SimEdge,
    sourcePos: { x: number; y: number },
    targetPos: { x: number; y: number },
    sourceRadius: number,
    targetRadius: number,
  ): JSX.Element | null => {
    const asymmetry = edge.regardAtoB - edge.regardBtoA;
    if (Math.abs(asymmetry) <= 0.3) return null;

    // Arrow points toward whoever is MORE liked (higher regard is FROM the other person)
    // If A's regard for B > B's regard for A, arrow points from A toward B
    let fromPos: { x: number; y: number }, toPos: { x: number; y: number }, toRadius: number;
    if (asymmetry > 0) {
      fromPos = sourcePos; toPos = targetPos; toRadius = targetRadius;
    } else {
      fromPos = targetPos; toPos = sourcePos; toRadius = sourceRadius;
    }

    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return null;

    const ux = dx / dist;
    const uy = dy / dist;

    // Arrow tip at edge of target node
    const tipX = toPos.x - ux * (toRadius + 4);
    const tipY = toPos.y - uy * (toRadius + 4);
    const arrowSize = 6;
    const baseX = tipX - ux * arrowSize;
    const baseY = tipY - uy * arrowSize;
    const perpX = -uy * arrowSize * 0.5;
    const perpY = ux * arrowSize * 0.5;

    return (
      <polygon
        points={`${tipX},${tipY} ${baseX + perpX},${baseY + perpY} ${baseX - perpX},${baseY - perpY}`}
        fill={regardToColor((edge.regardAtoB + edge.regardBtoA) / 2)}
        opacity={0.8}
      />
    );
  }, []);

  // Hover tooltip content for nodes
  const renderNodeTooltip = useCallback((npcId: string) => {
    const npc = npcs.find(n => n.id === npcId);
    if (!npc) return null;

    return (
      <div className="rel-graph-tooltip">
        <div className="rel-graph-tooltip-header">{npc.name}</div>
        {npc.mood && (
          <div className="rel-graph-tooltip-mood">Mood: {npc.mood}</div>
        )}
        {npc.currentGoal && (
          <div className="rel-graph-tooltip-goal">Goal: {npc.currentGoal}</div>
        )}
        <div className="rel-graph-tooltip-emotions">
          {EMOTION_KEYS.map(key => (
            <div key={key} className="rel-graph-emotion-bar-row">
              <span className="rel-graph-emotion-label">{key}</span>
              <div className="rel-graph-emotion-bar-bg">
                <div
                  className="rel-graph-emotion-bar-fill"
                  style={{
                    width: `${npc.emotionalState[key] * 100}%`,
                    backgroundColor: EMOTION_COLORS[key],
                  }}
                />
              </div>
              <span className="rel-graph-emotion-value">{(npc.emotionalState[key] * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>
    );
  }, [npcs]);

  // Hover tooltip content for edges
  const renderEdgeTooltip = useCallback((edgeKey: string) => {
    const [srcId, tgtId] = edgeKey.split(":");
    const srcNpc = npcs.find(n => n.id === srcId);
    const tgtNpc = npcs.find(n => n.id === tgtId);
    if (!srcNpc || !tgtNpc) return null;

    const relAtoB = srcNpc.relationships[tgtId];
    const relBtoA = tgtNpc.relationships[srcId];

    // Merge both directions, picking max |value| for each axis
    const combined: { axis: string; value: number }[] = [];
    for (const axis of REL_AXES) {
      const va = relAtoB?.[axis] ?? 0;
      const vb = relBtoA?.[axis] ?? 0;
      const avg = (va + vb) / 2;
      combined.push({ axis: REL_AXIS_LABELS[axis], value: avg });
    }
    // Sort by |value| descending, show top 3
    combined.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const top3 = combined.slice(0, 3);

    const velocity = store.getRelationshipVelocity(srcId, tgtId);

    return (
      <div className="rel-graph-tooltip">
        <div className="rel-graph-tooltip-header">
          {srcNpc.name} &harr; {tgtNpc.name}
        </div>
        {top3.map(({ axis, value }) => (
          <div key={axis} className="rel-graph-tooltip-axis">
            <span>{axis}:</span>{" "}
            <span style={{ color: value >= 0 ? "#81c784" : "#ef9a9a" }}>
              {value >= 0 ? "+" : ""}{value.toFixed(2)}
            </span>
          </div>
        ))}
        <div className="rel-graph-tooltip-velocity" style={{
          color: velocity.trend === "improving" ? "#81c784"
               : velocity.trend === "declining" ? "#ef9a9a"
               : "#90a4ae",
        }}>
          {velocity.trend === "improving" ? "Improving" : velocity.trend === "declining" ? "Declining" : "Stable"}
        </div>
      </div>
    );
  }, [npcs, store]);

  // Badge helpers
  const hasRevealedSecret = useCallback((npcId: string) => {
    // Show lock badge only when another NPC has learned one of this NPC's secrets
    return npcs.some(n => n.id !== npcId && (n.knownSecrets[npcId]?.length ?? 0) > 0);
  }, [npcs]);

  const hasActiveGrudge = useCallback((npcId: string) => {
    return store.getActiveGrudges(npcId).length > 0;
  }, [store, tick]);

  const hasPendingPromise = useCallback((npcId: string) => {
    return store.getPromisesFor(npcId).some(p => p.status === "active");
  }, [store, tick]);

  // Handle mouse move for tooltips — use viewport coords so overflow can't clip
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const flipX = localX > rect.width * 0.55;
    const flipY = localY > rect.height * 0.7;
    setTooltipPos({
      x: flipX ? e.clientX - 12 : e.clientX + 12,
      y: flipY ? e.clientY - 10 : e.clientY + 10,
      flipX,
      flipY,
    });
  }, []);

  return (
    <div className="rel-graph-container" ref={containerRef} onMouseMove={handleMouseMove}>
      <style>{`
        .rel-graph-container {
          position: fixed;
          left: 0;
          top: 0;
          bottom: 48px;
          width: 400px;
          background: rgba(13, 17, 23, 0.95);
          z-index: 100;
          display: flex;
          flex-direction: column;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #c9d1d9;
          box-shadow: 4px 0 24px rgba(0, 0, 0, 0.5);
        }
        .rel-graph-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          border-bottom: 1px solid #21262d;
          flex-shrink: 0;
        }
        .rel-graph-title {
          font-size: 14px;
          font-weight: 600;
          color: #e6edf3;
          letter-spacing: 0.3px;
        }
        .rel-graph-close {
          background: none;
          border: 1px solid #30363d;
          color: #8b949e;
          cursor: pointer;
          border-radius: 4px;
          padding: 2px 8px;
          font-size: 13px;
          transition: color 0.15s, border-color 0.15s;
        }
        .rel-graph-close:hover {
          color: #e6edf3;
          border-color: #8b949e;
        }
        .rel-graph-svg-wrap {
          flex: 1;
          min-height: 0;
          overflow: hidden;
          position: relative;
        }
        .rel-graph-svg-wrap svg {
          width: 100%;
          height: 100%;
        }
        .rel-graph-node-circle {
          cursor: pointer;
          transition: filter 0.15s;
        }
        .rel-graph-node-circle:hover {
          filter: brightness(1.3);
        }
        .rel-graph-node-label {
          font-size: 10px;
          fill: #8b949e;
          text-anchor: middle;
          pointer-events: none;
          user-select: none;
        }
        .rel-graph-edge {
          cursor: pointer;
          transition: opacity 0.15s;
        }
        .rel-graph-edge:hover {
          opacity: 1 !important;
        }
        @keyframes rel-graph-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        .rel-graph-edge-pulsing {
          animation: rel-graph-pulse 1.5s ease-in-out infinite;
        }
        .rel-graph-badge {
          font-size: 9px;
          pointer-events: none;
          user-select: none;
        }
        .rel-graph-tooltip {
          background: #161b22;
          border: 1px solid #30363d;
          border-radius: 6px;
          padding: 8px 10px;
          font-size: 11px;
          line-height: 1.5;
          color: #c9d1d9;
          pointer-events: none;
          z-index: 200;
          max-width: 220px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        }
        .rel-graph-tooltip-header {
          font-weight: 600;
          color: #e6edf3;
          margin-bottom: 4px;
          font-size: 12px;
        }
        .rel-graph-tooltip-mood {
          color: #d29922;
          margin-bottom: 2px;
        }
        .rel-graph-tooltip-goal {
          color: #8b949e;
          margin-bottom: 4px;
          font-style: italic;
        }
        .rel-graph-tooltip-emotions {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .rel-graph-emotion-bar-row {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .rel-graph-emotion-label {
          width: 52px;
          text-align: right;
          font-size: 10px;
          color: #8b949e;
          text-transform: capitalize;
        }
        .rel-graph-emotion-bar-bg {
          flex: 1;
          height: 6px;
          background: #21262d;
          border-radius: 3px;
          overflow: hidden;
        }
        .rel-graph-emotion-bar-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.3s;
        }
        .rel-graph-emotion-value {
          width: 28px;
          font-size: 9px;
          color: #8b949e;
          text-align: right;
        }
        .rel-graph-tooltip-axis {
          color: #c9d1d9;
        }
        .rel-graph-tooltip-velocity {
          margin-top: 4px;
          font-weight: 600;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .rel-graph-event-feed {
          flex-shrink: 0;
          height: 100px;
          border-top: 1px solid #21262d;
          overflow-y: auto;
          padding: 8px 12px;
        }
        .rel-graph-event-feed-title {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #484f58;
          margin-bottom: 4px;
        }
        .rel-graph-event-feed-placeholder {
          font-size: 11px;
          color: #30363d;
          font-style: italic;
        }
      `}</style>

      {/* Header */}
      <div className="rel-graph-header">
        <span className="rel-graph-title">Relationship Map</span>
        <button className="rel-graph-close" onClick={onClose}>Close</button>
      </div>

      {/* SVG Graph */}
      <div className="rel-graph-svg-wrap">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Edges */}
          {edges.map((edge) => {
            const srcPos = positions.get(edge.sourceId);
            const tgtPos = positions.get(edge.targetId);
            if (!srcPos || !tgtPos) return null;

            const avgRegard = (edge.regardAtoB + edge.regardBtoA) / 2;
            const color = regardToColor(avgRegard);
            const width = getEdgeWidth(edge.regardAtoB, edge.regardBtoA, edge.affection);
            const dashArray = getEdgeStyle(edge.trust);
            const edgeKey = `${edge.sourceId}:${edge.targetId}`;
            const velocity = store.getRelationshipVelocity(edge.sourceId, edge.targetId);
            const isPulsing = velocity.trend !== "stable";

            const srcNode = nodesRef.current.find(n => n.id === edge.sourceId);
            const tgtNode = nodesRef.current.find(n => n.id === edge.targetId);

            return (
              <g key={edgeKey}>
                {/* Hit area (wider invisible line for easier hovering) */}
                <line
                  x1={srcPos.x} y1={srcPos.y}
                  x2={tgtPos.x} y2={tgtPos.y}
                  stroke="transparent"
                  strokeWidth={12}
                  className="rel-graph-edge"
                  onMouseEnter={() => setHoveredEdge(edgeKey)}
                  onMouseLeave={() => setHoveredEdge(null)}
                />
                {/* Visible edge */}
                <line
                  x1={srcPos.x} y1={srcPos.y}
                  x2={tgtPos.x} y2={tgtPos.y}
                  stroke={color}
                  strokeWidth={width}
                  strokeDasharray={dashArray || undefined}
                  opacity={0.7}
                  className={isPulsing ? "rel-graph-edge-pulsing" : ""}
                  pointerEvents="none"
                />
                {/* Directional arrow for asymmetric regard */}
                {srcNode && tgtNode && renderArrow(
                  edge, srcPos, tgtPos, srcNode.radius, tgtNode.radius,
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {nodesRef.current.map((node) => {
            const pos = positions.get(node.id);
            if (!pos) return null;

            const npc = npcs.find(n => n.id === node.id);
            if (!npc) return null;

            const moodBorderColor = npc.mood
              ? MOOD_BORDER_COLORS[npc.mood] || "#6e7681"
              : "#6e7681";

            const strongCount = strongConnectionCounts.get(node.id) || 0;
            const radius = 20 + Math.min(strongCount, 5) * 2;

            // Badge positions
            const badges: { text: string; color: string; dx: number }[] = [];
            if (hasRevealedSecret(node.id)) badges.push({ text: "\u{1F512}", color: "#ffd700", dx: 0 });
            if (hasActiveGrudge(node.id)) badges.push({ text: "\u{1F525}", color: "#ef5350", dx: 0 });
            if (hasPendingPromise(node.id)) badges.push({ text: "\u{1F91D}", color: "#66bb6a", dx: 0 });

            return (
              <g key={node.id}>
                {/* Outer border (mood indicator) */}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={radius + 3}
                  fill="none"
                  stroke={moodBorderColor}
                  strokeWidth={2}
                  opacity={0.6}
                />
                {/* Main node circle */}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={radius}
                  fill="#0d1117"
                  stroke={npc.color}
                  strokeWidth={2.5}
                  className="rel-graph-node-circle"
                  onClick={() => onNpcClick?.(node.id)}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                />
                {/* Avatar text */}
                <text
                  x={pos.x}
                  y={pos.y + 1}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={radius * 0.8}
                  pointerEvents="none"
                  style={{ userSelect: "none" }}
                >
                  {npc.avatar}
                </text>
                {/* Name label below */}
                <text
                  x={pos.x}
                  y={pos.y + radius + 14}
                  className="rel-graph-node-label"
                >
                  {npc.name}
                </text>
                {/* Badges */}
                {badges.map((badge, i) => {
                  const angle = -Math.PI / 2 + (i - (badges.length - 1) / 2) * 0.6;
                  const bx = pos.x + Math.cos(angle) * (radius + 10);
                  const by = pos.y + Math.sin(angle) * (radius + 10);
                  return (
                    <text
                      key={i}
                      x={bx}
                      y={by}
                      className="rel-graph-badge"
                      textAnchor="middle"
                      dominantBaseline="central"
                    >
                      {badge.text}
                    </text>
                  );
                })}
              </g>
            );
          })}
        </svg>

        {/* Tooltip overlay — fixed positioning to escape overflow:hidden */}
        {hoveredNode && (
          <div style={{
            position: "fixed",
            left: tooltipPos.x,
            top: tooltipPos.y,
            transform: `translate(${tooltipPos.flipX ? "-100%" : "0"}, ${tooltipPos.flipY ? "-100%" : "0"})`,
            pointerEvents: "none",
            zIndex: 300,
          }}>
            {renderNodeTooltip(hoveredNode)}
          </div>
        )}
        {hoveredEdge && !hoveredNode && (
          <div style={{
            position: "fixed",
            left: tooltipPos.x,
            top: tooltipPos.y,
            transform: `translate(${tooltipPos.flipX ? "-100%" : "0"}, ${tooltipPos.flipY ? "-100%" : "0"})`,
            pointerEvents: "none",
            zIndex: 300,
          }}>
            {renderEdgeTooltip(hoveredEdge)}
          </div>
        )}
      </div>

      {/* Event Feed placeholder */}
      <div className="rel-graph-event-feed">
        <div className="rel-graph-event-feed-title">Event Feed</div>
        <div className="rel-graph-event-feed-placeholder">
          Relationship events will appear here...
        </div>
      </div>
    </div>
  );
}
