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

describe("redactSensitive grouped formats", () => {
  it("masks a space-grouped IBAN", () => {
    expect(redactSensitive("IBAN DE89 3704 0044 0532 0130 00")).toBe("IBAN ••••3000");
  });
  it("masks a space-grouped card number", () => {
    expect(redactSensitive("card 4111 1111 1111 1111")).toBe("card ••••1111");
  });
  it("masks a dash-grouped account number", () => {
    expect(redactSensitive("acct 1234-5678-9012")).toBe("acct ••••9012");
  });
  it("still masks contiguous IBAN and long digit runs", () => {
    expect(redactSensitive("DE89370400440532013000")).toBe("••••3000");
    expect(redactSensitive("ref 1234567890")).toBe("ref ••••7890");
  });
  it("leaves ordinary dates and amounts untouched", () => {
    expect(redactSensitive("due 2026-10-01 total €84.20")).toBe("due 2026-10-01 total €84.20");
    expect(redactSensitive("appointment 2026 10 12")).toBe("appointment 2026 10 12");
  });
});
