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

function TurnList({ speeches, speakerNames, convIndex, onPlayTurn, currentTurn }: {
  speeches: string[];
  speakerNames: string[];
  convIndex?: number;
  onPlayTurn?: (convIndex: number, turnIndex: number) => void;
  currentTurn?: number;
}) {
  return (
    <div className="dd-turns-scroll">
      {speeches.map((speech, i) => (
        <div
          key={i}
          className={`dd-turn-line${currentTurn !== undefined && i === currentTurn ? " dd-turn-current" : ""}${currentTurn !== undefined && i < currentTurn ? " dd-turn-played" : ""}`}
        >
          {onPlayTurn && convIndex !== undefined && (
            <button
              className="dd-play-btn"
              onClick={() => onPlayTurn(convIndex, i)}
              title="Play audio"
            >
              &#9654;
            </button>
          )}
          <span className="dd-turn-speaker">{speakerNames[i]}:</span>{" "}
          <span className="dd-turn-text">{speech}</span>
        </div>
      ))}
    </div>
  );
}

function PreparedCard({ info, convIndex, onPlayTurn }: {
  info: PreparedConversationInfo;
  convIndex: number;
  onPlayTurn?: (convIndex: number, turnIndex: number) => void;
}) {
  const isTts = info.phase === "generating_tts";
  return (
    <div className={`dd-card ${isTts ? "dd-card-preparing" : "dd-card-ready"}`}>
      <div className="dd-card-header">
        <div className="dd-pair-names">
          {info.npcAName} + {info.npcBName}
        </div>
        {isTts && (
          <span className="dd-phase-badge dd-phase-tts">
            TTS {formatDuration(info.ttsElapsedMs ?? 0)}
          </span>
        )}
      </div>
      <div className="dd-card-meta">
        {info.convType} &middot; {info.turnCount} turns
        &middot; LLM {formatDuration(info.llmDurationMs)}
        {!isTts && <> + TTS {formatDuration(info.ttsDurationMs)}</>}
      </div>
      {!isTts && <StalenessBar ageMs={info.ageMs} maxAgeMs={info.maxAgeMs} />}
      <TurnList
        speeches={info.speeches}
        speakerNames={info.speakerNames}
        convIndex={isTts ? undefined : convIndex}
        onPlayTurn={isTts ? undefined : onPlayTurn}
      />
    </div>
  );
}

export function DirectorDashboard({ getStatus, onClose, onPlayTurnAudio }: DirectorDashboardProps) {
  const [status, setStatus] = useState<DirectorStatus>(getStatus);

  useEffect(() => {
    const interval = setInterval(() => setStatus(getStatus()), 500);
    return () => clearInterval(interval);
  }, [getStatus]);

  // Count ready conversations (exclude TTS-in-progress for the "ready" pipeline slot)
  const readyCount = status.preparedConversations.filter(c => c.phase === "ready").length;
  const ttsConv = status.preparedConversations.find(c => c.phase === "generating_tts");

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
          <div className="dd-section-title">
            Pipeline
            <span className="dd-depth-badge">
              {status.pipelineDepth}/{status.maxPipelineDepth}
              {status.pipelineDepth >= status.maxPipelineDepth && (
                <span className="dd-depth-full"> (LLM paused)</span>
              )}
            </span>
          </div>
          {status.backoffRemainingSecs > 0 && (
            <div className="dd-backoff-banner">
              Rate limited — retrying in {status.backoffRemainingSecs}s
            </div>
          )}
          <div className="dd-pipeline">
            <div className={`dd-pipeline-slot ${status.generatingPair ? "dd-slot-active" : ""}`}>
              <span className="dd-slot-label">LLM</span>
              {status.generatingPair ? (
                <span className="dd-slot-detail">
                  {status.generatingPair.npcAName} + {status.generatingPair.npcBName}
                  <span className="dd-slot-time">{formatDuration(status.generatingPair.elapsedMs)}</span>
                </span>
              ) : (
                <span className="dd-slot-idle">
                  {status.backoffRemainingSecs > 0
                    ? "backoff"
                    : status.pipelineDepth >= status.maxPipelineDepth
                      ? "full"
                      : "idle"}
                </span>
              )}
            </div>
            <div className="dd-pipeline-arrow">&rarr;</div>
            <div className={`dd-pipeline-slot ${ttsConv ? "dd-slot-active" : ""}`}>
              <span className="dd-slot-label">TTS</span>
              {ttsConv ? (
                <span className="dd-slot-detail">
                  {ttsConv.npcAName} + {ttsConv.npcBName}
                  <span className="dd-slot-time">{formatDuration(ttsConv.ttsElapsedMs ?? 0)}</span>
                </span>
              ) : (
                <span className="dd-slot-idle">idle</span>
              )}
            </div>
            <div className="dd-pipeline-arrow">&rarr;</div>
            <div className={`dd-pipeline-slot ${readyCount > 0 ? "dd-slot-active" : ""}`}>
              <span className="dd-slot-label">Ready</span>
              <span className={readyCount > 0 ? "dd-slot-detail" : "dd-slot-idle"}>
                {readyCount > 0 ? `${readyCount} queued` : "empty"}
              </span>
            </div>
          </div>
        </div>

        {/* Groq rate limits */}
        {status.groqRateLimits && (() => {
          const rl = status.groqRateLimits;
          const tokenRatio = rl.limitTokens > 0 ? rl.remainingTokens / rl.limitTokens : 1;
          const reqRatio = rl.limitRequests > 0 ? rl.remainingRequests / rl.limitRequests : 1;
          const tokenPct = Math.round(tokenRatio * 100);
          const reqPct = Math.round(reqRatio * 100);
          const barColor = (ratio: number) =>
            ratio > 0.5 ? "#7ec87e" : ratio > 0.2 ? "#e0a84c" : "#e05050";
          return (
            <div className="dd-section">
              <div className="dd-section-title">
                Groq Quota
                <span className="dd-depth-badge">
                  {rl.model}
                  {status.modelDowngraded && (
                    <span className="dd-depth-full"> (auto-downgraded)</span>
                  )}
                </span>
              </div>
              <div className="dd-quota-row">
                <div className="dd-quota-item">
                  <div className="dd-quota-header">
                    <span>Tokens</span>
                    <span className="dd-quota-numbers">
                      {rl.remainingTokens.toLocaleString()} / {rl.limitTokens.toLocaleString()} ({tokenPct}%)
                    </span>
                  </div>
                  <div className="dd-quota-bar">
                    <div
                      className="dd-quota-fill"
                      style={{ width: `${tokenPct}%`, background: barColor(tokenRatio) }}
                    />
                  </div>
                </div>
                <div className="dd-quota-item">
                  <div className="dd-quota-header">
                    <span>Requests</span>
                    <span className="dd-quota-numbers">
                      {rl.remainingRequests} / {rl.limitRequests} ({reqPct}%)
                    </span>
                  </div>
                  <div className="dd-quota-bar">
                    <div
                      className="dd-quota-fill"
                      style={{ width: `${reqPct}%`, background: barColor(reqRatio) }}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Stats row */}
        <div className="dd-stats-row">
          <div className="dd-stat">
            <span className="dd-stat-value">{status.conversationsPlayed}</span>
            <span className="dd-stat-label">Played</span>
          </div>
          <div className="dd-stat">
            <span className="dd-stat-value">{status.preparedExpired}</span>
            <span className="dd-stat-label">Expired</span>
          </div>
          <div className="dd-stat">
            <span className="dd-stat-value">
              {status.avgLlmMs > 0 ? formatDuration(status.avgLlmMs) : "-"}
            </span>
            <span className="dd-stat-label">Avg LLM</span>
          </div>
          <div className="dd-stat">
            <span className="dd-stat-value">
              {status.avgTtsMs > 0 ? formatDuration(status.avgTtsMs) : "-"}
            </span>
            <span className="dd-stat-label">Avg TTS</span>
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
              {status.activeConversation.speeches.length > 0 && (
                <TurnList
                  speeches={status.activeConversation.speeches}
                  speakerNames={status.activeConversation.speakerNames}
                  currentTurn={status.activeConversation.turnCount - 1}
                />
              )}
            </div>
          </div>
        )}

        {/* Pipeline conversations (TTS-in-progress + ready) */}
        {status.preparedConversations.length > 0 && (
          <div className="dd-section">
            <div className="dd-section-title">
              In Pipeline ({status.preparedConversations.length})
            </div>
            {status.preparedConversations.map((info, i) => (
              <PreparedCard
                key={`${info.npcAName}-${info.npcBName}-${info.phase}`}
                info={info}
                convIndex={info.phase === "generating_tts" ? -1 : i - (ttsConv ? 1 : 0)}
                onPlayTurn={onPlayTurnAudio}
              />
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
