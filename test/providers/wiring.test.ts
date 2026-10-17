import { describe, it, expect } from "vitest";
import { resolveWiring } from "../../src/providers/wiring.js";

describe("resolveWiring", () => {
  it("uses rules and no vision with an empty environment", () => {
    const r = resolveWiring({}, { bedrockConfigured: false });
    expect(r.brain).toBe("rules");
    expect(r.vision).toBe("none");
    expect(r.providerWarnings).toEqual([]);
    expect(r.visionWarnings).toEqual([]);
  });

  it("uses Bedrock for brain and vision when only BEDROCK_MODEL_ID is configured", () => {
    const r = resolveWiring({ BEDROCK_MODEL_ID: "anthropic.claude-3" }, { bedrockConfigured: true });
    expect(r.brain).toBe("bedrock");
    expect(r.vision).toBe("bedrock");
  });

  it("uses the provider brain with Textract vision", () => {
    const r = resolveWiring(
      { WAYFINDER_PROVIDER: "google", GEMINI_API_KEY: "k", WAYFINDER_VISION: "textract" },
      { bedrockConfigured: false }
    );
    expect(r.brain).toBe("provider");
    expect(r.vision).toBe("textract");
  });

  it("falls back to rules and warns for an invalid provider", () => {
    const r = resolveWiring({ WAYFINDER_PROVIDER: "nope" }, { bedrockConfigured: false });
    expect(r.brain).toBe("rules");
    expect(r.vision).toBe("none");
    expect(r.providerWarnings.join(" ")).toContain("unknown provider");
  });

  it("uses the Bedrock brain when WAYFINDER_PROVIDER=bedrock and Bedrock is configured", () => {
    const r = resolveWiring({ WAYFINDER_PROVIDER: "bedrock" }, { bedrockConfigured: true });
    expect(r.brain).toBe("bedrock");
  });

  it("keeps vision off for an explicit WAYFINDER_VISION=none", () => {
    const r = resolveWiring({ WAYFINDER_VISION: "none" }, { bedrockConfigured: true });
    expect(r.vision).toBe("none");
  });
});
