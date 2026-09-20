import { describe, it, expect } from "vitest";
import { ibanIsValid, datePlausible, amountSane } from "../src/domain/validity.js";

const now = new Date("2026-09-20T12:00:00.000Z");

describe("ibanIsValid", () => {
  it("accepts valid IBANs, spaced or not, any case", () => {
    expect(ibanIsValid("DE89370400440532013000")).toBe(true);
    expect(ibanIsValid("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(ibanIsValid("gb29nwbk60161331926819")).toBe(true);
  });

  it("rejects a single-digit OCR misread", () => {
    expect(ibanIsValid("DE89370400440532013001")).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(ibanIsValid("")).toBe(false);
    expect(ibanIsValid("DE89")).toBe(false);
    expect(ibanIsValid("XX00 1234")).toBe(false);
  });
});

describe("datePlausible", () => {
  it("accepts a date inside the window", () => {
    expect(datePlausible("2026-10-01", now)).toBe(true);
  });
  it("rejects a date far in the past or future", () => {
    expect(datePlausible("2020-01-01", now)).toBe(false);
    expect(datePlausible("2035-01-01", now)).toBe(false);
  });
  it("rejects a non-ISO string", () => {
    expect(datePlausible("not-a-date", now)).toBe(false);
  });
  it("rejects a non-existent calendar day that JavaScript would otherwise normalize", () => {
    expect(datePlausible("2026-09-31", now)).toBe(false);
    expect(datePlausible("2026-02-30", now)).toBe(false);
    expect(datePlausible("2026-13-01", now)).toBe(false);
  });
  it("still accepts a valid ISO datetime", () => {
    expect(datePlausible("2026-10-01T09:00:00.000Z", now)).toBe(true);
  });
});

describe("amountSane", () => {
  it("rejects negative values", () => {
    expect(amountSane({ value: -1, currency: "EUR" })).toBe(false);
  });
  it("accepts a value without history", () => {
    expect(amountSane({ value: 1000000, currency: "EUR" })).toBe(true);
  });
  it("rejects an outlier beyond 20x the median", () => {
    expect(amountSane({ value: 5000, currency: "EUR" }, [80, 84, 90, 95])).toBe(false);
    expect(amountSane({ value: 120, currency: "EUR" }, [80, 84, 90, 95])).toBe(true);
  });
});
