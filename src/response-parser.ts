import type { LLMResponse, MentionedNpc, ActionData, ActionType } from "./types";

export function parseLLMResponse(raw: string): LLMResponse {
  const cleaned = extractJson(raw);
  try {
    return validate(JSON.parse(cleaned));
  } catch {
    // Attempt repair before giving up
    const repaired = repairJson(cleaned);
    return validate(JSON.parse(repaired));
  }
}

export function extractJson(raw: string): string {
  let s = raw.trim();

  // Strip markdown code fences (handle preamble text before fences)
  s = s.replace(/.*```(?:json)?\s*/is, "").replace(/\s*```\s*$/s, "");
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

export function repairJson(s: string): string {
  let r = s;

  // Remove trailing commas before } or ]
  r = r.replace(/,\s*([}\]])/g, "$1");

  // Fix unquoted keys: {speech: "hello"} -> {"speech": "hello"}
  r = r.replace(/([{,])\s*([a-zA-Z_]\w*)\s*:/g, '$1"$2":');

  // Fix single-quoted strings to double-quoted
  r = r.replace(/'([^']*?)'/g, '"$1"');

  // Replace undefined with null
  r = r.replace(/:\s*undefined\b/g, ": null");

  // Close truncated JSON — count unmatched braces/brackets
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;
  for (const ch of r) {
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") openBraces++;
    if (ch === "}") openBraces--;
    if (ch === "[") openBrackets++;
    if (ch === "]") openBrackets--;
  }
  if (inString) r += '"';
  while (openBrackets > 0) { r += "]"; openBrackets--; }
  while (openBraces > 0) { r += "}"; openBraces--; }

  return r;
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
  const emotions = (typeof ed === "object" && ed !== null ? ed : {}) as Record<string, unknown>;
  const emotionDelta = {
    anger: clampDelta(toNumber(emotions.anger, 0)),
    trust: clampDelta(toNumber(emotions.trust, 0)),
    fear: clampDelta(toNumber(emotions.fear, 0)),
    joy: clampDelta(toNumber(emotions.joy, 0)),
    sadness: clampDelta(toNumber(emotions.sadness, 0)),
    curiosity: clampDelta(toNumber(emotions.curiosity, 0)),
    disgust: clampDelta(toNumber(emotions.disgust, 0)),
    guilt: clampDelta(toNumber(emotions.guilt, 0)),
  };

  const rd = clampRelDelta(toNumber(o.relationship_delta, 0));
  const ad = clampRelDelta(toNumber(o.affection_delta, 0));
  const intent = typeof o.intent === "string" ? o.intent : "";
  const conversationEnd =
    typeof o.conversation_end === "boolean" ? o.conversation_end : false;

  let mentionedNpcs: MentionedNpc[] | undefined;
  if (Array.isArray(o.mentioned_npcs)) {
    mentionedNpcs = (o.mentioned_npcs as Record<string, unknown>[])
      .filter(
        (m) =>
          typeof m.npc_id === "string" &&
          typeof m.what_was_said === "string"
      )
      .map((m) => ({
        npc_id: m.npc_id as string,
        sentiment: Math.max(-1, Math.min(1, toNumber(m.sentiment, 0))),
        what_was_said: String(m.what_was_said),
      }));
    if (mentionedNpcs.length === 0) mentionedNpcs = undefined;
  }

  const secretRevealed =
    typeof o.secret_revealed === "string" && o.secret_revealed.length > 0
      ? o.secret_revealed
      : undefined;

  const promise =
    typeof o.promise === "string" && o.promise.length > 0
      ? o.promise
      : undefined;

  let action: ActionData | undefined;
  if (typeof o.action === "object" && o.action !== null) {
    const a = o.action as Record<string, unknown>;
    const validActions: ActionType[] = [
      "give_gift", "mock", "storm_off", "embrace",
      "threaten", "conspire", "spread_rumor",
    ];
    if (typeof a.action === "string" && validActions.includes(a.action as ActionType)) {
      action = {
        action: a.action as ActionType,
        target_npc_id: typeof a.target_npc_id === "string" ? a.target_npc_id : undefined,
        detail: typeof a.detail === "string" ? a.detail : undefined,
      };
      // conspire and spread_rumor require target_npc_id
      if ((action.action === "conspire" || action.action === "spread_rumor") && !action.target_npc_id) {
        action = undefined;
      }
    }
  }

  return {
    speech: o.speech as string,
    emotion_delta: emotionDelta,
    relationship_delta: rd,
    affection_delta: ad,
    intent,
    conversation_end: conversationEnd,
    mentioned_npcs: mentionedNpcs,
    secret_revealed: secretRevealed,
    promise,
    action,
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
