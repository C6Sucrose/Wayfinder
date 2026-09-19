import { describe, it, expect } from "vitest";
import { scoreScam } from "../src/domain/scam.js";

describe("scoreScam", () => {
  it("returns high risk for a gift-card payment demand", () => {
    const r = scoreScam("Urgent: pay with gift cards within 24 hours.", {
      hasQrOrLink: true, hasPaymentRequest: true, senderMismatch: true
    });
    expect(r.band).toBe("high");
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("returns low risk for normal mail", () => {
    const r = scoreScam("Your appointment is confirmed.", {
      hasQrOrLink: false, hasPaymentRequest: false, senderMismatch: false
    });
    expect(r.band).toBe("low");
  });
});
