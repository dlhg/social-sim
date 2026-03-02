const OLLAMA_URL = "/api/chat";
const MODEL = "qwen2.5:7b";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function accumulateChat(
  messages: ChatMessage[],
  onProgress?: (accumulated: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: true,
    }),
    signal,
  });

  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
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
