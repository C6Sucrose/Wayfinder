import { describe, it, expect } from "vitest";
import { classifyText, type Signals } from "../src/domain/classifier.js";

const noSignals: Signals = { hasQrOrLink: false, hasPaymentRequest: false, senderMismatch: false };

describe("classifyText", () => {
  it("classifies a bill", () => {
    const r = classifyText("Amount due: 84.20 EUR. Payment due by 1 October 2026.", noSignals);
    expect(r.class).toBe("bill");
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("classifies an appointment", () => {
    const r = classifyText("Your appointment is scheduled for 12 November 2026 at 09:30.", noSignals);
    expect(r.class).toBe("appointment");
  });

  it("classifies insurance", () => {
    const r = classifyText("Your policy premium and coverage summary for this claim.", noSignals);
    expect(r.class).toBe("insurance");
  });

  it("flags scam when strong signals are present", () => {
    const r = classifyText("Urgent: pay immediately with gift cards to avoid arrest.", {
      hasQrOrLink: true, hasPaymentRequest: true, senderMismatch: true
    });
    expect(r.class).toBe("scam");
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("falls back to personal or junk when nothing matches", () => {
    const r = classifyText("Hi, hope you are well. See you soon.", noSignals);
    expect(["personal", "junk"]).toContain(r.class);
  });
});
