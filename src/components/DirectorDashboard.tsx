import { useEffect, useState } from "react";
import type { DirectorStatus, PreparedConversationInfo } from "../conversation-manager";

interface DirectorDashboardProps {
  getStatus: () => DirectorStatus;
  onClose: () => void;
  onPlayTurnAudio?: (convIndex: number, turnIndex: number) => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
}

function StalenessBar({ ageMs, maxAgeMs }: { ageMs: number; maxAgeMs: number }) {
  const ratio = ageMs / maxAgeMs;
  return (
    <div className="dd-staleness">
      Age: {formatDuration(ageMs)} / {formatDuration(maxAgeMs)}
      <div className="dd-staleness-bar">
        <div
          className="dd-staleness-fill"
          style={{
            width: `${Math.min(100, ratio * 100)}%`,
            background: ratio > 0.75 ? "#e05050" : ratio > 0.5 ? "#e0a84c" : "#7ec87e",
          }}
        />
      </div>
    </div>
  );
}

function PreparedCard({ info, convIndex, onPlayTurn }: {
  info: PreparedConversationInfo;
  convIndex: number;
  onPlayTurn?: (convIndex: number, turnIndex: number) => void;
}) {
  return (
    <div className="dd-card dd-card-ready">
      <div className="dd-pair-names">
        {info.npcAName} + {info.npcBName}
      </div>
      <div className="dd-card-meta">
        {info.convType} &middot; {info.turnCount} turns
        &middot; LLM {formatDuration(info.llmDurationMs)} + TTS {formatDuration(info.ttsDurationMs)}
      </div>
      <StalenessBar ageMs={info.ageMs} maxAgeMs={info.maxAgeMs} />
      <div className="dd-turns-scroll">
        {info.speeches.map((speech, i) => (
          <div key={i} className="dd-turn-line">
            {onPlayTurn && (
              <button
                className="dd-play-btn"
                onClick={() => onPlayTurn(convIndex, i)}
                title="Play audio"
              >
                &#9654;
              </button>
            )}
            <span className="dd-turn-speaker">{info.speakerNames[i]}:</span>{" "}
            <span className="dd-turn-text">{speech}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DirectorDashboard({ getStatus, onClose, onPlayTurnAudio }: DirectorDashboardProps) {
  const [status, setStatus] = useState<DirectorStatus>(getStatus);

  useEffect(() => {
    const interval = setInterval(() => setStatus(getStatus()), 500);
    return () => clearInterval(interval);
  }, [getStatus]);

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

        {/* Pipeline status */}
        <div className="dd-section">
          <div className="dd-section-title">Pipeline</div>
          <div className="dd-pipeline">
            <div className={`dd-pipeline-slot ${status.generatingPair ? "dd-slot-active" : ""}`}>
              <span className="dd-slot-label">LLM</span>
              {status.generatingPair ? (
                <span className="dd-slot-detail">
                  {status.generatingPair.npcAName} + {status.generatingPair.npcBName}
                  <span className="dd-slot-time">{formatDuration(status.generatingPair.elapsedMs)}</span>
                </span>
              ) : (
                <span className="dd-slot-idle">idle</span>
              )}
            </div>
            <div className="dd-pipeline-arrow">&rarr;</div>
            <div className={`dd-pipeline-slot ${status.prefetchingPair ? "dd-slot-active" : ""}`}>
              <span className="dd-slot-label">TTS</span>
              {status.prefetchingPair ? (
                <span className="dd-slot-detail">
                  {status.prefetchingPair.npcAName} + {status.prefetchingPair.npcBName}
                  <span className="dd-slot-time">{formatDuration(status.prefetchingPair.elapsedMs)}</span>
                </span>
              ) : (
                <span className="dd-slot-idle">idle</span>
              )}
            </div>
            <div className="dd-pipeline-arrow">&rarr;</div>
            <div className={`dd-pipeline-slot ${status.preparedConversations.length > 0 ? "dd-slot-active" : ""}`}>
              <span className="dd-slot-label">Ready</span>
              <span className={status.preparedConversations.length > 0 ? "dd-slot-detail" : "dd-slot-idle"}>
                {status.preparedConversations.length > 0
                  ? `${status.preparedConversations.length} queued`
                  : "empty"}
              </span>
            </div>
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

        {/* Prepared conversations */}
        {status.preparedConversations.length > 0 && (
          <div className="dd-section">
            <div className="dd-section-title">
              Ready for Playback ({status.preparedConversations.length})
            </div>
            {status.preparedConversations.map((info, i) => (
              <PreparedCard key={i} info={info} convIndex={i} onPlayTurn={onPlayTurnAudio} />
            ))}
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
