export type LlmProvider = "ollama" | "groq" | "gemini";

export interface LlmConfig {
  provider: LlmProvider;
  ollamaModel: string;
  groqApiKey: string;
  groqModel: string;
  geminiApiKey: string;
  geminiModel: string;
}

const STORAGE_KEY = "llm-config";

const DEFAULTS: LlmConfig = {
  provider: "ollama",
  ollamaModel: "qwen2.5:7b",
  groqApiKey: "",
  groqModel: "llama-3.3-70b-versatile",
  geminiApiKey: "",
  geminiModel: "gemini-2.5-flash",
};

export const GROQ_MODELS = [
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B (fast)" },
  { id: "openai/gpt-oss-120b", label: "GPT OSS 120B" },
  { id: "openai/gpt-oss-20b", label: "GPT OSS 20B (fast)" },
  { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 17B" },
  { id: "qwen/qwen3-32b", label: "Qwen 3 32B" },
];

export const GEMINI_MODELS = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite (fast)" },
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
