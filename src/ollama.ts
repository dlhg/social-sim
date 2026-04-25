/**
 * LLM client — supports both local Ollama and cloud Groq (OpenAI-compatible).
 * The provider is selected at call time via the persisted LlmConfig.
 */

import { loadLlmConfig } from "./llm-config";

const OLLAMA_URL = "/api/chat";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const CLAUDE_URL = "/anthropic-api/v1/messages";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GroqRateLimits {
  limitRequests: number;
  remainingRequests: number;
  limitTokens: number;
  remainingTokens: number;
  resetRequests: string;
  resetTokens: string;
  model: string;
}

let latestGroqRateLimits: GroqRateLimits | null = null;

export function getGroqRateLimits(): GroqRateLimits | null {
  return latestGroqRateLimits;
}

// ── LLM call guard (burst + session cap) ────────

export class LlmCallLimitError extends Error {
  constructor(public readonly reason: "burst" | "session_cap", message: string) {
    super(message);
    this.name = "LlmCallLimitError";
  }
}

const LLM_SESSION_CAP = 500;
const LLM_BURST_WINDOW_MS = 60_000;
const LLM_BURST_MAX = 20;

let llmSessionCalls = 0;
let llmGuardTripped: "burst" | "session_cap" | null = null;
const llmCallTimestamps: number[] = [];

function llmCallGuard(): void {
  if (llmGuardTripped) {
    throw new LlmCallLimitError(
      llmGuardTripped,
      `LLM call guard tripped (${llmGuardTripped}). Call resetLlmCallGuard() to resume.`
    );
  }

  const now = Date.now();

  // Burst detection: too many calls in a short window
  // Prune old timestamps
  while (llmCallTimestamps.length > 0 && now - llmCallTimestamps[0] > LLM_BURST_WINDOW_MS) {
    llmCallTimestamps.shift();
  }
  if (llmCallTimestamps.length >= LLM_BURST_MAX) {
    llmGuardTripped = "burst";
    throw new LlmCallLimitError(
      "burst",
      `LLM burst limit: ${LLM_BURST_MAX} calls in ${LLM_BURST_WINDOW_MS / 1000}s window`
    );
  }

  // Session cap
  if (llmSessionCalls >= LLM_SESSION_CAP) {
    llmGuardTripped = "session_cap";
    throw new LlmCallLimitError(
      "session_cap",
      `LLM session cap reached: ${LLM_SESSION_CAP} calls`
    );
  }

  llmCallTimestamps.push(now);
  llmSessionCalls++;
}

export interface LlmCallStats {
  sessionCalls: number;
  sessionCap: number;
  burstCount: number;
  burstMax: number;
  guardTripped: "burst" | "session_cap" | null;
}

export function getLlmCallStats(): LlmCallStats {
  const now = Date.now();
  // Count only timestamps within the current window
  const burstCount = llmCallTimestamps.filter(t => now - t <= LLM_BURST_WINDOW_MS).length;
  return {
    sessionCalls: llmSessionCalls,
    sessionCap: LLM_SESSION_CAP,
    burstCount,
    burstMax: LLM_BURST_MAX,
    guardTripped: llmGuardTripped,
  };
}

export function resetLlmCallGuard(): void {
  llmGuardTripped = null;
  // Don't reset sessionCalls — the cap is lifetime for the tab.
  // But do clear the burst window so the director can resume.
  llmCallTimestamps.length = 0;
}

export interface AccumulateChatOptions {
  onProgress?: (accumulated: string) => void;
  signal?: AbortSignal;
  numPredict?: number;
  /** Override the configured model for this single call (used for auto-downgrade) */
  modelOverride?: string;
}

export async function accumulateChat(
  messages: ChatMessage[],
  onProgressOrOpts?: ((accumulated: string) => void) | AccumulateChatOptions,
  signal?: AbortSignal
): Promise<string> {
  // Support both old (positional) and new (options object) calling styles
  let onProgress: ((accumulated: string) => void) | undefined;
  let abortSignal = signal;
  let numPredict: number | undefined;
  let modelOverride: string | undefined;

  if (typeof onProgressOrOpts === "function") {
    onProgress = onProgressOrOpts;
  } else if (onProgressOrOpts) {
    onProgress = onProgressOrOpts.onProgress;
    abortSignal = onProgressOrOpts.signal ?? signal;
    numPredict = onProgressOrOpts.numPredict;
    modelOverride = onProgressOrOpts.modelOverride;
  }

  llmCallGuard();

  const config = loadLlmConfig();

  if (config.provider === "groq") {
    const model = modelOverride ?? config.groqModel;
    return accumulateGroq(messages, config.groqApiKey, model, numPredict, onProgress, abortSignal);
  }
  if (config.provider === "gemini") {
    const model = modelOverride ?? config.geminiModel;
    return accumulateGemini(messages, config.geminiApiKey, model, numPredict, onProgress, abortSignal);
  }
  if (config.provider === "claude") {
    const model = modelOverride ?? config.claudeModel;
    return accumulateClaude(messages, config.claudeApiKey, model, numPredict, onProgress, abortSignal);
  }
  return accumulateOllama(messages, config.ollamaModel, numPredict, onProgress, abortSignal);
}

// ── Ollama (local, NDJSON stream) ──────────────

async function accumulateOllama(
  messages: ChatMessage[],
  model: string,
  numPredict: number | undefined,
  onProgress: ((accumulated: string) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    format: "json",
  };
  if (numPredict) {
    body.options = { num_predict: numPredict };
  }

  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama error: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`);
  }

  if (!res.body) {
    throw new Error("Ollama response body is null");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split("\n")) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        if (json.message?.content) {
          full += json.message.content;
          onProgress?.(full);
        }
      } catch {
        // skip malformed NDJSON lines
      }
    }
  }

  return full;
}

// ── Groq (cloud, SSE stream) ───────────────────

async function accumulateGroq(
  messages: ChatMessage[],
  apiKey: string,
  model: string,
  numPredict: number | undefined,
  onProgress: ((accumulated: string) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (!apiKey) {
    throw new Error("Groq API key is not set. Configure it in the setup screen.");
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    response_format: { type: "json_object" },
  };
  if (numPredict) {
    body.max_tokens = numPredict;
  }

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  // Capture rate limit headers before checking status (429s still send these)
  const rlLimitReq = res.headers.get("x-ratelimit-limit-requests");
  if (rlLimitReq) {
    latestGroqRateLimits = {
      limitRequests: parseInt(rlLimitReq),
      remainingRequests: parseInt(res.headers.get("x-ratelimit-remaining-requests") ?? "0"),
      limitTokens: parseInt(res.headers.get("x-ratelimit-limit-tokens") ?? "0"),
      remainingTokens: parseInt(res.headers.get("x-ratelimit-remaining-tokens") ?? "0"),
      resetRequests: res.headers.get("x-ratelimit-reset-requests") ?? "",
      resetTokens: res.headers.get("x-ratelimit-reset-tokens") ?? "",
      model,
    };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Groq error: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`);
  }

  if (!res.body) {
    throw new Error("Groq response body is null");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (!trimmed.startsWith("data: ")) continue;

      try {
        const json = JSON.parse(trimmed.slice(6));
        const content = json.choices?.[0]?.delta?.content;
        if (content) {
          full += content;
          onProgress?.(full);
        }
      } catch {
        // skip malformed SSE lines
      }
    }
  }

  return full;
}

// ── Claude (Anthropic Messages API, SSE stream) ──

async function accumulateClaude(
  messages: ChatMessage[],
  apiKey: string,
  model: string,
  numPredict: number | undefined,
  onProgress: ((accumulated: string) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (!apiKey) {
    throw new Error("Claude API key is not set. Configure it in the setup screen.");
  }

  // Anthropic API: system is a top-level param, not in the messages array
  const systemParts: string[] = [];
  const apiMessages: { role: string; content: string }[] = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      systemParts.push(msg.content);
    } else {
      apiMessages.push({ role: msg.role, content: msg.content });
    }
  }

  const body: Record<string, unknown> = {
    model,
    messages: apiMessages,
    stream: true,
    max_tokens: numPredict ?? 4096,
  };
  if (systemParts.length > 0) {
    body.system = systemParts.join("\n\n");
  }

  const res = await fetch(CLAUDE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Claude error: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`);
  }

  if (!res.body) {
    throw new Error("Claude response body is null");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("event:")) continue;
      if (!trimmed.startsWith("data: ")) continue;

      try {
        const json = JSON.parse(trimmed.slice(6));
        // Anthropic streaming: content_block_delta events carry text
        if (json.type === "content_block_delta" && json.delta?.text) {
          full += json.delta.text;
          onProgress?.(full);
        }
      } catch {
        // skip malformed SSE lines
      }
    }
  }

  return full;
}

// ── Gemini (cloud, OpenAI-compatible SSE stream) ──

async function accumulateGemini(
  messages: ChatMessage[],
  apiKey: string,
  model: string,
  numPredict: number | undefined,
  onProgress: ((accumulated: string) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (!apiKey) {
    throw new Error("Gemini API key is not set. Configure it in the setup screen.");
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    response_format: { type: "json_object" },
  };
  if (numPredict) {
    body.max_tokens = numPredict;
  }

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini error: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`);
  }

  if (!res.body) {
    throw new Error("Gemini response body is null");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (!trimmed.startsWith("data: ")) continue;

      try {
        const json = JSON.parse(trimmed.slice(6));
        const content = json.choices?.[0]?.delta?.content;
        if (content) {
          full += content;
          onProgress?.(full);
        }
      } catch {
        // skip malformed SSE lines
      }
    }
  }

  return full;
}
