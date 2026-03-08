const OLLAMA_URL = "/api/chat";
const MODEL = "qwen2.5:7b";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AccumulateChatOptions {
  onProgress?: (accumulated: string) => void;
  signal?: AbortSignal;
  numPredict?: number;
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

  if (typeof onProgressOrOpts === "function") {
    onProgress = onProgressOrOpts;
  } else if (onProgressOrOpts) {
    onProgress = onProgressOrOpts.onProgress;
    abortSignal = onProgressOrOpts.signal ?? signal;
    numPredict = onProgressOrOpts.numPredict;
  }

  const body: Record<string, unknown> = {
    model: MODEL,
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
    signal: abortSignal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama error: ${res.status} ${res.statusText}${body ? ` — ${body}` : ""}`);
  }

  const reader = res.body!.getReader();
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
