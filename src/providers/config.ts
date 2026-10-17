import { PRESETS, type ProviderId, type ProviderPreset } from "./registry.js";

export interface ChatChoice {
  kind: "chat";
  id: ProviderId;
  protocol: ProviderPreset["protocol"];
  model: string;
  baseUrl: string;
  apiKey: string;
  apiKeyFound: boolean;
  supportsImages: boolean;
  maxRounds: number;
  timeoutMs: number;
  authHeader?: ProviderPreset["authHeader"];
  query?: Record<string, string>;
}

export type ProviderChoice = { kind: "rules" } | ChatChoice;

export interface ProviderResolution {
  provider: ProviderChoice;
  warnings: string[];
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function resolveProviderConfig(env: NodeJS.ProcessEnv): ProviderResolution {
  const warnings: string[] = [];
  const id = (env.WAYFINDER_PROVIDER ?? "rules").trim() as ProviderId;
  if (id === "rules") return { provider: { kind: "rules" }, warnings };

  const preset = PRESETS[id as Exclude<ProviderId, "rules">];
  if (!preset) {
    warnings.push(`unknown provider "${id}"; using rules`);
    return { provider: { kind: "rules" }, warnings };
  }

  const baseUrl = (env.WAYFINDER_BASE_URL ?? preset.baseUrl).trim();
  if (preset.id === "custom" && !baseUrl) {
    warnings.push("custom provider requires WAYFINDER_BASE_URL; using rules");
    return { provider: { kind: "rules" }, warnings };
  }

  const model = (env.WAYFINDER_MODEL ?? preset.defaultModel).trim();
  if (!model && preset.id !== "bedrock") {
    warnings.push(`${id} needs WAYFINDER_MODEL; using rules`);
    return { provider: { kind: "rules" }, warnings };
  }

  const apiKey = (env.WAYFINDER_API_KEY ?? (preset.apiKeyEnv ? env[preset.apiKeyEnv] : undefined) ?? "").trim();
  if (preset.id !== "bedrock" && !apiKey) {
    warnings.push(`${id} has no API key (${preset.apiKeyEnv || "WAYFINDER_API_KEY"}); using rules`);
    return { provider: { kind: "rules" }, warnings };
  }

  const query = preset.query ? { ...preset.query } : undefined;
  return {
    provider: {
      kind: "chat",
      id: preset.id,
      protocol: preset.protocol,
      model,
      baseUrl,
      apiKey,
      apiKeyFound: apiKey !== "",
      supportsImages: preset.supportsImages,
      maxRounds: positiveInt(env.WAYFINDER_MAX_ROUNDS, 4),
      timeoutMs: positiveInt(env.WAYFINDER_TIMEOUT_MS, 15000),
      authHeader: preset.authHeader,
      ...(query !== undefined ? { query } : {})
    },
    warnings
  };
}

export type VisionKind = "none" | "textract" | "provider" | "bedrock";

export function resolveVision(env: NodeJS.ProcessEnv, provider: ProviderChoice): { kind: VisionKind; warnings: string[] } {
  const warnings: string[] = [];
  const kind = (env.WAYFINDER_VISION ?? "none").trim() as VisionKind;
  if (kind === "none" || kind === "textract" || kind === "bedrock") return { kind, warnings };
  if (kind === "provider") {
    if (provider.kind === "chat" && provider.supportsImages) return { kind: "provider", warnings };
    warnings.push("the selected provider does not support images; vision is off");
    return { kind: "none", warnings };
  }
  warnings.push(`unknown vision "${kind}"; vision is off`);
  return { kind: "none", warnings };
}
