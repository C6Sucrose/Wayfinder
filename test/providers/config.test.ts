import { describe, it, expect } from "vitest";
import { resolveProviderConfig, resolveVision } from "../../src/providers/config.js";

describe("resolveProviderConfig", () => {
  it("defaults to rules with no warnings", () => {
    const r = resolveProviderConfig({});
    expect(r.provider).toEqual({ kind: "rules" });
    expect(r.warnings).toEqual([]);
  });

  it("resolves an OpenAI-compatible provider from its standard key", () => {
    const r = resolveProviderConfig({ WAYFINDER_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" });
    expect(r.provider).toMatchObject({ kind: "chat", id: "openai", protocol: "openai-compatible", model: "gpt-4o-mini", apiKeyFound: true });
  });

  it("honours WAYFINDER_MODEL and WAYFINDER_BASE_URL", () => {
    const r = resolveProviderConfig({
      WAYFINDER_PROVIDER: "openai",
      WAYFINDER_MODEL: "custom-model",
      WAYFINDER_BASE_URL: "https://example.test/v1",
      WAYFINDER_API_KEY: "k"
    });
    expect(r.provider).toMatchObject({ model: "custom-model", baseUrl: "https://example.test/v1" });
  });

  it("prefers WAYFINDER_API_KEY over the preset env", () => {
    const r = resolveProviderConfig({ WAYFINDER_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "a", WAYFINDER_API_KEY: "b" });
    expect(r.provider).toMatchObject({ apiKey: "b" });
  });

  it("falls back to rules with a warning when the key is missing", () => {
    const r = resolveProviderConfig({ WAYFINDER_PROVIDER: "anthropic" });
    expect(r.provider).toEqual({ kind: "rules" });
    expect(r.warnings.join(" ")).toContain("no API key");
  });

  it("falls back to rules for an unknown provider", () => {
    const r = resolveProviderConfig({ WAYFINDER_PROVIDER: "nope" });
    expect(r.provider).toEqual({ kind: "rules" });
    expect(r.warnings.join(" ")).toContain("unknown provider");
  });

  it("requires a base URL for custom", () => {
    const r = resolveProviderConfig({ WAYFINDER_PROVIDER: "custom", WAYFINDER_API_KEY: "k" });
    expect(r.provider).toEqual({ kind: "rules" });
    expect(r.warnings.join(" ")).toContain("WAYFINDER_BASE_URL");
  });

  it("never puts the key in warnings", () => {
    const r = resolveProviderConfig({ WAYFINDER_PROVIDER: "custom", WAYFINDER_API_KEY: "super-secret" });
    expect(r.warnings.join(" ")).not.toContain("super-secret");
  });
});

describe("resolveVision", () => {
  it("defaults to none", () => {
    expect(resolveVision({}, { kind: "rules" }).kind).toBe("none");
  });

  it("accepts textract", () => {
    expect(resolveVision({ WAYFINDER_VISION: "textract" }, { kind: "rules" }).kind).toBe("textract");
  });

  it("rejects provider vision when the provider cannot see images", () => {
    const r = resolveVision({ WAYFINDER_VISION: "provider" }, { kind: "chat", id: "openai", protocol: "openai-compatible", model: "m", apiKey: "k", apiKeyFound: true, baseUrl: "u", supportsImages: false, maxRounds: 4, timeoutMs: 15000 });
    expect(r.kind).toBe("none");
    expect(r.warnings.join(" ")).toContain("does not support images");
  });

  it("accepts provider vision when images are supported", () => {
    const r = resolveVision({ WAYFINDER_VISION: "provider" }, { kind: "chat", id: "google", protocol: "openai-compatible", model: "m", apiKey: "k", apiKeyFound: true, baseUrl: "u", supportsImages: true, maxRounds: 4, timeoutMs: 15000 });
    expect(r.kind).toBe("provider");
  });
});
