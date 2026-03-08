import { useEffect, useState } from "react";
import type { DirectorStatus } from "../conversation-manager";

interface DirectorDashboardProps {
  getStatus: () => DirectorStatus;
  onClose: () => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
}

const PHASE_LABELS: Record<DirectorStatus["phase"], string> = {
  idle: "Idle",
  llm_generating: "Generating (LLM)",
  tts_prefetching: "Prefetching TTS",
  ready: "Ready",
};

const PHASE_COLORS: Record<DirectorStatus["phase"], string> = {
  idle: "#9896a8",
  llm_generating: "#e0a84c",
  tts_prefetching: "#6ca6d9",
  ready: "#7ec87e",
};

export function DirectorDashboard({ getStatus, onClose }: DirectorDashboardProps) {
  const [status, setStatus] = useState<DirectorStatus>(getStatus);

  useEffect(() => {
    const interval = setInterval(() => setStatus(getStatus()), 500);
    return () => clearInterval(interval);
  }, [getStatus]);

  const now = Date.now();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content director-dashboard"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header-row">
          <h3>Director Dashboard</h3>
          <button className="modal-close-x" onClick={onClose}>X</button>
        </div>

        {/* Phase indicator */}
        <div className="dd-section">
          <div className="dd-phase-row">
            <span className="dd-label">Phase</span>
            <span
              className="dd-phase-badge"
              style={{ background: PHASE_COLORS[status.phase] }}
            >
              {PHASE_LABELS[status.phase]}
            </span>
          </div>
        </div>

        {/* Stats row */}
        <div className="dd-stats-row">
          <div className="dd-stat">
            <span className="dd-stat-value">{status.conversationsPlayed}</span>
            <span className="dd-stat-label">Played</span>
          </div>
          <div className="dd-stat">
            <span className="dd-stat-value">{status.preparedConsumed}</span>
            <span className="dd-stat-label">Instant</span>
          </div>
          <div className="dd-stat">
            <span className="dd-stat-value">{status.preparedExpired}</span>
            <span className="dd-stat-label">Expired</span>
          </div>
          <div className="dd-stat">
            <span className="dd-stat-value">
              {status.conversationsPlayed > 0
                ? `${Math.round((status.preparedConsumed / status.conversationsPlayed) * 100)}%`
                : "-"}
            </span>
            <span className="dd-stat-label">Hit rate</span>
          </div>
        </div>

        {/* Active conversation */}
        {status.activeConversation && (
          <div className="dd-section">
            <div className="dd-section-title">Now Playing</div>
            <div className="dd-card dd-card-active">
              <div className="dd-pair-names">
                {status.activeConversation.npcAName} + {status.activeConversation.npcBName}
              </div>
              <div className="dd-card-meta">
                {status.activeConversation.convType} &middot; turn{" "}
                {status.activeConversation.turnCount}/{status.activeConversation.maxTurns}
              </div>
            </div>
          </div>
        )}

        {/* Preparing */}
        {status.preparingPair && (status.phase === "llm_generating" || status.phase === "tts_prefetching") && (
          <div className="dd-section">
            <div className="dd-section-title">Preparing</div>
            <div className="dd-card dd-card-preparing">
              <div className="dd-pair-names">
                {status.preparingPair.npcAName} + {status.preparingPair.npcBName}
              </div>
              <div className="dd-timing-bar">
                <div className="dd-timing-segment dd-timing-llm" style={{
                  opacity: status.phase === "llm_generating" ? 1 : 0.5,
                }}>
                  LLM{" "}
                  {status.llmFinishedAt && status.prepareStartedAt
                    ? formatDuration(status.llmFinishedAt - status.prepareStartedAt)
                    : status.prepareStartedAt
                    ? formatDuration(now - status.prepareStartedAt) + "..."
                    : ""}
                </div>
                <div className="dd-timing-segment dd-timing-tts" style={{
                  opacity: status.phase === "tts_prefetching" ? 1 : 0.3,
                }}>
                  TTS{" "}
                  {status.ttsFinishedAt && status.llmFinishedAt
                    ? formatDuration(status.ttsFinishedAt - status.llmFinishedAt)
                    : status.llmFinishedAt
                    ? formatDuration(now - status.llmFinishedAt) + "..."
                    : ""}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Prepared / ready */}
        {status.prepared && (
          <div className="dd-section">
            <div className="dd-section-title">Ready for Playback</div>
            <div className="dd-card dd-card-ready">
              <div className="dd-pair-names">
                {status.prepared.npcAName} + {status.prepared.npcBName}
              </div>
              <div className="dd-card-meta">
                {status.prepared.convType} &middot; {status.prepared.turnCount} turns
              </div>
              <div className="dd-staleness">
                Age: {formatDuration(status.prepared.ageMs)} / {formatDuration(status.prepared.maxAgeMs)}
                <div className="dd-staleness-bar">
                  <div
                    className="dd-staleness-fill"
                    style={{
                      width: `${Math.min(100, (status.prepared.ageMs / status.prepared.maxAgeMs) * 100)}%`,
                      background: status.prepared.ageMs / status.prepared.maxAgeMs > 0.75
                        ? "#e05050"
                        : status.prepared.ageMs / status.prepared.maxAgeMs > 0.5
                        ? "#e0a84c"
                        : "#7ec87e",
                    }}
                  />
                </div>
              </div>
              {/* Timing breakdown */}
              {status.prepareStartedAt && status.ttsFinishedAt && (
                <div className="dd-card-meta" style={{ marginTop: 6 }}>
                  Total: {formatDuration(status.ttsFinishedAt - status.prepareStartedAt)}
                  {status.llmFinishedAt && (
                    <> (LLM {formatDuration(status.llmFinishedAt - status.prepareStartedAt)} + TTS {formatDuration(status.ttsFinishedAt - status.llmFinishedAt)})</>
                  )}
                </div>
              )}
              {/* Preview turns */}
              <div className="dd-turns-preview">
                {status.prepared.speeches.map((speech, i) => (
                  <div key={i} className="dd-turn-line">
                    <span className="dd-turn-speaker">{status.prepared!.speakerNames[i]}:</span>{" "}
                    <span className="dd-turn-text">{speech.length > 80 ? speech.slice(0, 80) + "..." : speech}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Top pairs */}
        {status.topPairs.length > 0 && (
          <div className="dd-section">
            <div className="dd-section-title">Top Ranked Pairs</div>
            <div className="dd-pairs-table">
              {status.topPairs.map((pair, i) => (
                <div key={i} className="dd-pair-row">
                  <span className="dd-pair-rank">#{i + 1}</span>
                  <span className="dd-pair-names-small">
                    {pair.npcAName} + {pair.npcBName}
                  </span>
                  <span className="dd-pair-score">{pair.score}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
