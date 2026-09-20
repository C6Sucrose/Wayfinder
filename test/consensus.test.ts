import { describe, it, expect } from "vitest";
import { compareReadings } from "../src/domain/consensus.js";

describe("compareReadings", () => {
  it("agrees when both reads match", () => {
    const a = { sender: "City Water", dueDate: "2026-10-01", amount: { value: 84.2, currency: "EUR" } };
    const b = { sender: "City Water", dueDate: "2026-10-01", amount: { value: 84.2, currency: "EUR" } };
    expect(compareReadings(a, b)).toEqual({ confidence: "high", disagreements: [] });
  });

  it("flags a differing amount", () => {
    const result = compareReadings({ amount: { value: 84.2, currency: "EUR" } }, { amount: { value: 842, currency: "EUR" } });
    expect(result.confidence).toBe("low");
    expect(result.disagreements).toContain("amount.value");
  });

  it("flags a field present on only one side", () => {
    const result = compareReadings({ reference: "INV-1" }, {});
    expect(result.confidence).toBe("low");
    expect(result.disagreements).toContain("reference");
  });

  it("treats both-absent as agreement", () => {
    expect(compareReadings({}, {})).toEqual({ confidence: "high", disagreements: [] });
  });

  it("collects multiple disagreements", () => {
    const result = compareReadings({ sender: "A", dueDate: "2026-10-01" }, { sender: "B", dueDate: "2026-11-01" });
    expect(result.disagreements.sort()).toEqual(["dueDate", "sender"]);
  });

  it("ignores case and collapses whitespace when comparing text fields", () => {
    expect(compareReadings({ reference: "INV-1" }, { reference: "inv-1" }).confidence).toBe("high");
    expect(compareReadings({ sender: "City   Water" }, { sender: "city water" }).confidence).toBe("high");
    expect(compareReadings({ sender: "City Water" }, { sender: "city waters" }).confidence).toBe("low");
  });
});
