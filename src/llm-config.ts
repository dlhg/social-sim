export type LlmProvider = "ollama" | "groq";

export interface LlmConfig {
  provider: LlmProvider;
  ollamaModel: string;
  groqApiKey: string;
  groqModel: string;
}

const STORAGE_KEY = "llm-config";

const DEFAULTS: LlmConfig = {
  provider: "ollama",
  ollamaModel: "qwen2.5:7b",
  groqApiKey: "",
  groqModel: "llama-3.3-70b-versatile",
};

export const GROQ_MODELS = [
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B (fast)" },
  { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
  { id: "gemma2-9b-it", label: "Gemma 2 9B" },
];

export function loadLlmConfig(): LlmConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveLlmConfig(config: LlmConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}
