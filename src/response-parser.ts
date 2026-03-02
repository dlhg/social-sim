import type { LLMResponse } from "./types";

export function parseLLMResponse(raw: string): LLMResponse {
  const cleaned = extractJson(raw);
  const parsed = JSON.parse(cleaned);
  return validate(parsed);
}

function extractJson(raw: string): string {
  let s = raw.trim();

  // Strip markdown code fences
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  s = s.trim();

  // Find JSON object boundaries if needed
  if (!s.startsWith("{")) {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end > start) {
      s = s.slice(start, end + 1);
    }
  }

  return s;
}

function validate(obj: unknown): LLMResponse {
  if (typeof obj !== "object" || obj === null) {
    throw new Error("Response is not an object");
  }

  const o = obj as Record<string, unknown>;

  if (typeof o.speech !== "string" || o.speech.length === 0) {
    throw new Error('Missing or empty "speech" field');
  }

  const ed = o.emotion_delta;
  if (typeof ed !== "object" || ed === null) {
    throw new Error('Missing "emotion_delta" field');
  }
  const emotions = ed as Record<string, unknown>;
  const emotionDelta = {
    anger: clampDelta(toNumber(emotions.anger, 0)),
    trust: clampDelta(toNumber(emotions.trust, 0)),
    fear: clampDelta(toNumber(emotions.fear, 0)),
    joy: clampDelta(toNumber(emotions.joy, 0)),
  };

  const rd = clampRelDelta(toNumber(o.relationship_delta, 0));
  const intent = typeof o.intent === "string" ? o.intent : "";
  const conversationEnd =
    typeof o.conversation_end === "boolean" ? o.conversation_end : false;

  return {
    speech: o.speech as string,
    emotion_delta: emotionDelta,
    relationship_delta: rd,
    intent,
    conversation_end: conversationEnd,
  };
}

function toNumber(val: unknown, fallback: number): number {
  if (typeof val === "number" && !Number.isNaN(val)) return val;
  if (typeof val === "string") {
    const n = parseFloat(val);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

function clampDelta(v: number): number {
  return Math.max(-0.2, Math.min(0.2, v));
}

function clampRelDelta(v: number): number {
  return Math.max(-0.1, Math.min(0.1, v));
}
