export interface AlexaConfig {
  mount: boolean;
  verifyEnabled: boolean;
  warnings: string[];
}

export function resolveAlexaConfig(env: NodeJS.ProcessEnv): AlexaConfig {
  const mount = (env.WAYFINDER_ALEXA ?? "on").trim().toLowerCase() !== "off";
  const bypass = (env.WAYFINDER_ALEXA_VERIFY ?? "on").trim().toLowerCase() === "off";
  const warnings = bypass ? ["signature verification is disabled; do not use this on a public endpoint"] : [];
  return { mount, verifyEnabled: !bypass, warnings };
}
