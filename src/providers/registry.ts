import type { Protocol } from "./types.js";

export type ProviderId =
  | "rules" | "openai" | "azure" | "google" | "anthropic" | "bedrock"
  | "deepseek" | "qwen" | "moonshot" | "zhipu" | "minimax"
  | "groq" | "together" | "mistral" | "openrouter" | "custom";

export interface ProviderPreset {
  id: Exclude<ProviderId, "rules">;
  protocol: Protocol;
  baseUrl: string;
  defaultModel: string;
  apiKeyEnv: string;
  authHeader: "authorization" | "api-key";
  supportsImages: boolean;
  query?: Record<string, string>;
}

const openai = (id: ProviderPreset["id"], baseUrl: string, defaultModel: string, apiKeyEnv: string, supportsImages = false): ProviderPreset => ({
  id, protocol: "openai-compatible", baseUrl, defaultModel, apiKeyEnv, authHeader: "authorization", supportsImages
});

export const PRESETS: Record<Exclude<ProviderId, "rules">, ProviderPreset> = {
  openai: openai("openai", "https://api.openai.com/v1", "gpt-4o-mini", "OPENAI_API_KEY", true),
  azure: { id: "azure", protocol: "openai-compatible", baseUrl: "", defaultModel: "gpt-4o-mini", apiKeyEnv: "AZURE_OPENAI_API_KEY", authHeader: "api-key", supportsImages: true, query: { "api-version": "2024-10-21" } },
  google: openai("google", "https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.0-flash", "GEMINI_API_KEY", true),
  anthropic: { id: "anthropic", protocol: "anthropic-messages", baseUrl: "https://api.anthropic.com", defaultModel: "claude-sonnet-4-5", apiKeyEnv: "ANTHROPIC_API_KEY", authHeader: "api-key", supportsImages: true },
  bedrock: { id: "bedrock", protocol: "bedrock-converse", baseUrl: "", defaultModel: "", apiKeyEnv: "", authHeader: "authorization", supportsImages: true },
  deepseek: openai("deepseek", "https://api.deepseek.com", "deepseek-chat", "DEEPSEEK_API_KEY"),
  qwen: openai("qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus", "DASHSCOPE_API_KEY"),
  moonshot: openai("moonshot", "https://api.moonshot.cn/v1", "moonshot-v1-8k", "MOONSHOT_API_KEY"),
  zhipu: openai("zhipu", "https://open.bigmodel.cn/api/paas/v4", "glm-4-flash", "ZHIPU_API_KEY"),
  minimax: openai("minimax", "https://api.minimax.chat/v1", "abab6.5s-chat", "MINIMAX_API_KEY"),
  groq: openai("groq", "https://api.groq.com/openai/v1", "llama-3.3-70b-versatile", "GROQ_API_KEY"),
  together: openai("together", "https://api.together.xyz/v1", "meta-llama/Llama-3.3-70B-Instruct-Turbo", "TOGETHER_API_KEY"),
  mistral: openai("mistral", "https://api.mistral.ai/v1", "mistral-large-latest", "MISTRAL_API_KEY"),
  openrouter: openai("openrouter", "https://openrouter.ai/api/v1", "openai/gpt-4o-mini", "OPENROUTER_API_KEY", true),
  custom: openai("custom", "", "", "WAYFINDER_API_KEY", false)
};
