import { describe, it, expect } from "vitest";
import { classifyText, type Signals } from "../src/domain/classifier.js";

const noSignals: Signals = { hasQrOrLink: false, hasPaymentRequest: false, senderMismatch: false, genericSalutation: false };

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
      hasQrOrLink: true, hasPaymentRequest: true, senderMismatch: true, genericSalutation: false
    });
    expect(r.class).toBe("scam");
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("falls back to personal or junk when nothing matches", () => {
    const r = classifyText("Hi, hope you are well. See you soon.", noSignals);
    expect(["personal", "junk"]).toContain(r.class);
  });

  it("keeps a legitimate final-notice bill classified as a bill", () => {
    const r = classifyText("Amount due: €84.20. Payment due 1 October 2026. Final notice.", {
      hasQrOrLink: false, hasPaymentRequest: true, senderMismatch: false, genericSalutation: false
    });
    expect(r.class).toBe("bill");
  });

  it("flags a gift-card demand corroborated by urgency and sender mismatch", () => {
    const r = classifyText("Urgent: pay with gift cards to release your parcel.", {
      hasQrOrLink: false, hasPaymentRequest: true, senderMismatch: true, genericSalutation: false
    });
    expect(r.class).toBe("scam");
  });

  it("does not match words that merely contain rule substrings", () => {
    expect(classifyText("Take a taxi to the office.", noSignals).class).not.toBe("government");
    expect(classifyText("Please determine the outcome.", noSignals).class).not.toBe("appointment");
  });
});

const base: Signals = { hasQrOrLink: false, hasPaymentRequest: false, senderMismatch: false, genericSalutation: false };

describe("generic salutation handling", () => {
  it("does not treat a normal bill with a generic greeting as a scam", () => {
    const r = classifyText("Dear customer, payment due on 2026-10-01.", { ...base, hasPaymentRequest: true, genericSalutation: true });
    expect(r.class).toBe("bill");
  });
  it("still flags a corroborated phishing letter", () => {
    const r = classifyText("Dear customer, urgent: pay now https://evil.example", {
      ...base, hasPaymentRequest: true, genericSalutation: true, hasQrOrLink: true
    });
    expect(r.class).toBe("scam");
  });
  it("reports a truthful reason for a generic greeting", () => {
    const r = classifyText("Dear customer, urgent: pay now https://evil.example", {
      ...base, hasPaymentRequest: true, genericSalutation: true, hasQrOrLink: true
    });
    expect(r.reasons.join(" ")).not.toMatch(/does not match the claimed organisation/);
    expect(r.reasons.join(" ")).toMatch(/generic greeting/);
  });
});
