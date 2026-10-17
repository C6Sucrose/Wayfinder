import { resolveProviderConfig, resolveVision } from "./config.js";

export type BrainKind = "rules" | "provider" | "bedrock";
export type VisionKindResolved = "none" | "textract" | "bedrock";

export function resolveWiring(
  env: NodeJS.ProcessEnv,
  opts: { bedrockConfigured: boolean }
): {
  brain: BrainKind;
  vision: VisionKindResolved;
  providerWarnings: string[];
  visionWarnings: string[];
} {
  const providerConfig = resolveProviderConfig(env);
  const provider = providerConfig.provider;

  let brain: BrainKind;
  if (provider.kind === "chat" && provider.protocol === "openai-compatible") {
    brain = "provider";
  } else if (provider.kind === "chat" && provider.id === "bedrock") {
    brain = opts.bedrockConfigured ? "bedrock" : "rules";
  } else {
    brain = opts.bedrockConfigured ? "bedrock" : "rules";
  }

  const visionConfig = resolveVision(env, provider);
  const visionWarnings = [...visionConfig.warnings];
  let vision: VisionKindResolved;
  switch (visionConfig.kind) {
    case "textract":
      vision = "textract";
      break;
    case "bedrock":
      vision = opts.bedrockConfigured ? "bedrock" : "none";
      break;
    case "provider":
      vision = "none";
      visionWarnings.push("provider vision is not implemented; use textract");
      break;
    case "none":
      vision = env.WAYFINDER_VISION === undefined && opts.bedrockConfigured ? "bedrock" : "none";
      break;
  }

  return { brain, vision, providerWarnings: providerConfig.warnings, visionWarnings };
}
