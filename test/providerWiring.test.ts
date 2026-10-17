import { describe, it, expect } from "vitest";
import { resolveProviderConfig, resolveVision } from "../src/providers/config.js";

describe("startup wiring", () => {
  it("selects Textract vision and a chat provider from env", () => {
    const provider = resolveProviderConfig({ WAYFINDER_PROVIDER: "google", GEMINI_API_KEY: "k", WAYFINDER_MODEL: "gemini-2.0-flash" });
    expect(provider.provider.kind).toBe("chat");
    expect(resolveVision({ WAYFINDER_VISION: "textract" }, provider.provider).kind).toBe("textract");
  });

  it("falls back to rules and no vision when config is empty", () => {
    const provider = resolveProviderConfig({});
    expect(provider.provider.kind).toBe("rules");
    expect(resolveVision({}, provider.provider).kind).toBe("none");
  });
});
