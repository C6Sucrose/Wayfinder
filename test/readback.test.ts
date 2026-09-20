import { describe, it, expect } from "vitest";
import { assessReadback } from "../src/domain/readback.js";

const now = new Date("2026-09-20T12:00:00.000Z");

describe("assessReadback", () => {
  it("is high for a clean reading", () => {
    const result = assessReadback({
      text: "Amount due: €84.20. Payment due 2026-10-01.",
      fields: { dueDate: "2026-10-01", amount: { currency: "EUR", value: 84.2 } },
      now
    });
    expect(result).toEqual({ confidence: "high", needsRecapture: false, reasons: [] });
  });

  it("flags an IBAN that fails its checksum", () => {
    const result = assessReadback({ text: "Account DE89370400440532013001.", fields: {}, now });
    expect(result.confidence).toBe("low");
    expect(result.reasons).toContain("account");
  });

  it("accepts a valid IBAN", () => {
    expect(assessReadback({ text: "Account DE89370400440532013000.", fields: {}, now }).confidence).toBe("high");
  });

  it("flags an implausible due date", () => {
    expect(assessReadback({ text: "x", fields: { dueDate: "2020-01-01" }, now }).reasons).toContain("dueDate");
  });

  it("flags an amount beyond the historical median", () => {
    const result = assessReadback({ text: "x", fields: { amount: { currency: "EUR", value: 5000 } }, history: [80, 84, 90, 95], now });
    expect(result.reasons).toContain("amount");
  });

  it("requests recapture whenever the reading is low", () => {
    expect(assessReadback({ text: "x", fields: { dueDate: "2020-01-01" }, now }).needsRecapture).toBe(true);
  });
});
