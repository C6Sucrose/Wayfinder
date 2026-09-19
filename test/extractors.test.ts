import { describe, it, expect } from "vitest";
import { extractFields, maskAccount } from "../src/domain/extractors.js";

describe("extractFields", () => {
  it("extracts an ISO due date and amount", () => {
    const f = extractFields("Amount due: €84.20. Payment due 2026-10-01.", "bill");
    expect(f.dueDate).toBe("2026-10-01");
    expect(f.amount).toEqual({ value: 84.2, currency: "EUR" });
  });

  it("parses a long-form English date", () => {
    const f = extractFields("Appointment scheduled for 12 November 2026 at 09:30.", "appointment");
    expect(f.appointmentAt?.startsWith("2026-11-12")).toBe(true);
  });

  it("masks an account number", () => {
    expect(maskAccount("DE89370400440532013000")).toBe("••••3000");
  });

  it("extracts a masked account from text", () => {
    const f = extractFields("Account number IBAN DE89370400440532013000", "bill");
    expect(f.maskedAccount).toBe("••••3000");
  });
});
