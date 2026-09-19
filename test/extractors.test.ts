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

describe("amount normalization", () => {
  it("parses US comma-thousands with a dot decimal", () => {
    expect(extractFields("Amount due: $1,234.56", "bill").amount).toEqual({ value: 1234.56, currency: "USD" });
  });

  it("parses EU dot-thousands with a comma decimal", () => {
    expect(extractFields("Amount due: €1.234,56", "bill").amount).toEqual({ value: 1234.56, currency: "EUR" });
  });

  it("parses comma-thousands without a decimal", () => {
    expect(extractFields("Amount due: $1,234", "bill").amount).toEqual({ value: 1234, currency: "USD" });
  });

  it("parses an ungrouped 4-digit integer with a decimal", () => {
    expect(extractFields("Amount due: $1234.56", "bill").amount).toEqual({ value: 1234.56, currency: "USD" });
  });

  it("parses an ungrouped 4-digit integer without a decimal", () => {
    expect(extractFields("Amount due: $1000", "bill").amount).toEqual({ value: 1000, currency: "USD" });
  });

  it("parses a space-grouped GBP amount", () => {
    expect(extractFields("Amount due: £4 999.00", "bill").amount).toEqual({ value: 4999, currency: "GBP" });
  });

  it("derives currency from the matched symbol in mixed-currency text", () => {
    expect(extractFields("You may pay €10.00, or in dollars $20.00.", "bill").amount).toEqual({ value: 10, currency: "EUR" });
  });
});

describe("reference redaction", () => {
  it("masks an IBAN embedded inside a reference value", () => {
    const f = extractFields("Reference INV-DE89370400440532013000", "bill");
    expect(f.reference).toBe("INV-••••3000");
    expect(JSON.stringify(f)).not.toContain("DE89370400440532013000");
  });
});

describe("account masking safety", () => {
  it("detects and masks a lowercase IBAN", () => {
    const f = extractFields("Account de89370400440532013000", "bill");
    expect(f.maskedAccount).toBe("••••3000");
  });

  it("never exposes a raw IBAN in any field, including reference", () => {
    const raw = "DE89370400440532013000";
    const f = extractFields(`Reference ${raw}`, "bill");
    expect(JSON.stringify(f)).not.toContain(raw);
    expect(f.reference).toBe("••••3000");
  });

  it("does not fully expose short account inputs", () => {
    expect(maskAccount("1234")).toBe("••••34");
    expect(maskAccount("123")).toBe("••••23");
    expect(maskAccount("12")).toBe("••••");
    expect(maskAccount("")).toBe("••••");
  });
});
