import { useState, useRef, useEffect } from "react";
import type { NPC } from "../types";

interface ConfessionalPanelProps {
  npc: NPC;
  questions: { text: string; category: string }[];
  onAsk: (question: string) => void;
  onClose: () => void;
  response: string | null;
  isLoading: boolean;
  diminishingMultiplier: number;
}

const EMOTION_COLORS: Record<string, string> = {
  joy: "#d4a832",
  anger: "#c94040",
  trust: "#4a9e5c",
  fear: "#8b5ec9",
  sadness: "#4a7ec9",
  curiosity: "#3db8b8",
  guilt: "#9b7eb8",
};

const EMOTION_ORDER = ["joy", "anger", "trust", "fear", "sadness", "curiosity", "guilt"] as const;

export function ConfessionalPanel({
  npc,
  questions,
  onAsk,
  onClose,
  response,
  isLoading,
  diminishingMultiplier,
}: ConfessionalPanelProps) {
  const [inputText, setInputText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const disabled = isLoading || diminishingMultiplier === 0;

  useEffect(() => {
    if (inputRef.current && !disabled) inputRef.current.focus();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed || disabled) return;
    setInputText("");
    onAsk(trimmed);
  }

  return (
    <>
      <style>{`
        .confessional-panel {
          position: fixed;
          right: 0;
          top: 0;
          bottom: 48px;
          width: 320px;
          background: var(--bg-base, #0d1117);
          border-left: 1px solid var(--border-subtle, #1e2632);
          display: flex;
          flex-direction: column;
          z-index: 100;
          animation: confessional-slide-in 0.2s ease-out;
          font-family: var(--font-ui, -apple-system, sans-serif);
        }
        @keyframes confessional-slide-in {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .confessional-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-subtle, #1e2632);
        }
        .confessional-npc-name {
          font-size: 16px;
          font-weight: 600;
        }
        .confessional-mood-badge {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 10px;
          background: rgba(255,255,255,0.06);
          color: var(--text-muted, #6b7280);
          margin-left: 8px;
        }
        .confessional-close {
          background: none;
          border: none;
          color: var(--text-muted, #6b7280);
          font-size: 18px;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
        }
        .confessional-close:hover {
          background: rgba(255,255,255,0.06);
          color: var(--text-primary, #e0e0e0);
        }
        .confessional-emotions {
          padding: 10px 16px;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .confessional-emotion-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .confessional-emotion-label {
          font-size: 10px;
          color: var(--text-muted, #6b7280);
          width: 52px;
          text-align: right;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .confessional-emotion-bar-bg {
          flex: 1;
          height: 4px;
          background: rgba(255,255,255,0.04);
          border-radius: 2px;
          overflow: hidden;
        }
        .confessional-emotion-bar {
          height: 100%;
          border-radius: 2px;
          transition: width 0.3s;
        }
        .confessional-body {
          flex: 1;
          overflow-y: auto;
          padding: 12px 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .confessional-question-btn {
          display: block;
          width: 100%;
          text-align: left;
          padding: 10px 12px;
          background: rgba(255,255,255,0.03);
          border: 1px solid var(--border-subtle, #1e2632);
          border-radius: 8px;
          color: var(--text-secondary, #b0b8c4);
          font-size: 13px;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
          font-family: inherit;
          line-height: 1.4;
        }
        .confessional-question-btn:hover:not(:disabled) {
          background: rgba(255,255,255,0.06);
          border-color: rgba(255,255,255,0.12);
          color: var(--text-primary, #e0e0e0);
        }
        .confessional-question-btn:disabled {
          opacity: 0.4;
          cursor: default;
        }
        .confessional-input-form {
          display: flex;
          gap: 6px;
          padding: 12px 16px;
          border-top: 1px solid var(--border-subtle, #1e2632);
        }
        .confessional-input {
          flex: 1;
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--border-subtle, #1e2632);
          border-radius: 6px;
          padding: 8px 10px;
          color: var(--text-primary, #e0e0e0);
          font-size: 13px;
          font-family: inherit;
          outline: none;
        }
        .confessional-input:focus {
          border-color: rgba(255,255,255,0.15);
        }
        .confessional-input:disabled {
          opacity: 0.4;
        }
        .confessional-send-btn {
          background: rgba(255,255,255,0.08);
          border: 1px solid var(--border-subtle, #1e2632);
          border-radius: 6px;
          padding: 8px 14px;
          color: var(--text-secondary, #b0b8c4);
          font-size: 13px;
          cursor: pointer;
          font-family: inherit;
        }
        .confessional-send-btn:hover:not(:disabled) {
          background: rgba(255,255,255,0.12);
        }
        .confessional-send-btn:disabled {
          opacity: 0.4;
          cursor: default;
        }
        .confessional-response {
          padding: 12px 16px;
          background: rgba(255,255,255,0.02);
          border-left: 3px solid var(--border-subtle, #1e2632);
          margin: 8px 0;
          border-radius: 0 6px 6px 0;
        }
        .confessional-response-text {
          font-size: 14px;
          color: var(--text-primary, #e0e0e0);
          line-height: 1.5;
          font-style: italic;
        }
        .confessional-loading {
          font-size: 14px;
          color: var(--text-muted, #6b7280);
          padding: 12px 0;
        }
        .confessional-exhausted {
          font-size: 13px;
          color: var(--text-muted, #6b7280);
          padding: 12px 0;
          font-style: italic;
        }
      `}</style>
      <div className="confessional-panel">
        <div className="confessional-header">
          <div style={{ display: "flex", alignItems: "center" }}>
            <span className="confessional-npc-name" style={{ color: npc.color }}>
              {npc.name}
            </span>
            {npc.mood && (
              <span className="confessional-mood-badge">{npc.mood}</span>
            )}
          </div>
          <button className="confessional-close" onClick={onClose}>×</button>
        </div>

        <div className="confessional-emotions">
          {EMOTION_ORDER.map((key) => (
            <div key={key} className="confessional-emotion-row">
              <span className="confessional-emotion-label">{key}</span>
              <div className="confessional-emotion-bar-bg">
                <div
                  className="confessional-emotion-bar"
                  style={{
                    width: `${npc.emotionalState[key] * 100}%`,
                    background: EMOTION_COLORS[key],
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="confessional-body">
          {diminishingMultiplier === 0 ? (
            <div className="confessional-exhausted">
              {npc.name} seems preoccupied...
            </div>
          ) : (
            <>
              {questions.map((q, i) => (
                <button
                  key={i}
                  className="confessional-question-btn"
                  disabled={disabled}
                  onClick={() => onAsk(q.text)}
                >
                  {q.text}
                </button>
              ))}

              {isLoading && (
                <div className="confessional-loading">...</div>
              )}

              {response && (
                <div className="confessional-response" style={{ borderLeftColor: npc.color + "80" }}>
                  <span className="confessional-response-text">"{response}"</span>
                </div>
              )}
            </>
          )}
        </div>

        <form className="confessional-input-form" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className="confessional-input"
            type="text"
            placeholder="Ask something..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={disabled}
          />
          <button
            type="submit"
            className="confessional-send-btn"
            disabled={disabled || !inputText.trim()}
          >
            Ask
          </button>
        </form>
      </div>
    </>
  );
}
