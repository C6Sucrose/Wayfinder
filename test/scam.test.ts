import { describe, it, expect } from "vitest";
import { scoreScam } from "../src/domain/scam.js";

describe("scoreScam", () => {
  it("returns high risk for a gift-card payment demand", () => {
    const r = scoreScam("Urgent: pay with gift cards within 24 hours.", {
      hasQrOrLink: true, hasPaymentRequest: true, senderMismatch: true, genericSalutation: false
    });
    expect(r.band).toBe("high");
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("returns low risk for normal mail", () => {
    const r = scoreScam("Your appointment is confirmed.", {
      hasQrOrLink: false, hasPaymentRequest: false, senderMismatch: false, genericSalutation: false
    });
    expect(r.band).toBe("low");
  });

  it("keeps an ordinary payment-due bill out of the high band", () => {
    const r = scoreScam("Payment due by 1 October 2026. Final notice.", {
      hasQrOrLink: false, hasPaymentRequest: true, senderMismatch: false, genericSalutation: false
    });
    expect(r.band).not.toBe("high");
    expect(r.riskScore).toBeLessThan(0.35);
  });

  it("rounds the risk score to two decimals", () => {
    const r = scoreScam("Pay now.", { hasQrOrLink: true, hasPaymentRequest: true, senderMismatch: true, genericSalutation: false });
    expect(r.riskScore).toBe(0.7);
  });
});
