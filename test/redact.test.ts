import { describe, it, expect } from "vitest";
import { redactSensitive } from "../src/domain/redact.js";

describe("redactSensitive", () => {
  it("masks an IBAN-shaped token embedded in text", () => {
    const out = redactSensitive("Account DE89370400440532013000 was charged.");
    expect(out).not.toContain("DE89370400440532013000");
    expect(out).toContain("••••3000");
  });

  it("masks lowercase IBANs", () => {
    const out = redactSensitive("iban de89370400440532013000");
    expect(out).not.toContain("de89370400440532013000");
    expect(out).toContain("••••3000");
  });

  it("masks long digit runs but leaves short numbers and dates alone", () => {
    const out = redactSensitive("Amount 84.20 due 2026-10-01, card 1234567890.");
    expect(out).toContain("84.20");
    expect(out).toContain("2026-10-01");
    expect(out).not.toContain("1234567890");
    expect(out).toContain("••••7890");
  });
});
