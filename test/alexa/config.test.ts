import { describe, it, expect } from "vitest";
import { resolveAlexaConfig } from "../../src/alexa/config.js";

describe("resolveAlexaConfig", () => {
  it("mounts the skill with verification on by default", () => {
    const r = resolveAlexaConfig({});
    expect(r.mount).toBe(true);
    expect(r.verifyEnabled).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it("disables the mount when asked", () => {
    expect(resolveAlexaConfig({ WAYFINDER_ALEXA: "off" }).mount).toBe(false);
  });

  it("disables verification only on an explicit switch, with a warning", () => {
    const r = resolveAlexaConfig({ WAYFINDER_ALEXA_VERIFY: "off" });
    expect(r.verifyEnabled).toBe(false);
    expect(r.warnings.join(" ")).toContain("signature verification is disabled");
  });

  it("ignores any other verification value", () => {
    expect(resolveAlexaConfig({ WAYFINDER_ALEXA_VERIFY: "nope" }).verifyEnabled).toBe(true);
  });

  it("reads the allowed application id", () => {
    expect(resolveAlexaConfig({ WAYFINDER_ALEXA_APP_ID: "amzn1.ask.skill.ok" }).appId).toBe("amzn1.ask.skill.ok");
  });

  it("leaves the application id unset when blank", () => {
    expect(resolveAlexaConfig({ WAYFINDER_ALEXA_APP_ID: "  " }).appId).toBeUndefined();
    expect(resolveAlexaConfig({}).appId).toBeUndefined();
  });
});
