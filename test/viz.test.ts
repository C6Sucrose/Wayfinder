import { describe, it, expect } from "vitest";
import { clamp01, confidenceRing, urgencyMeter, ledgerChain } from "../ui/src/viz.js";

describe("clamp01", () => {
  it("clamps and handles non-finite input", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(NaN)).toBe(0);
  });
});

describe("confidenceRing", () => {
  it("maps confidence to a fraction, radius, circumference, and offset", () => {
    expect(confidenceRing(0.75, 40)).toEqual({
      size: 40,
      radius: 17,
      circumference: 106.81,
      offset: 26.7,
      percent: 75,
      low: false
    });
  });

  it("flags low confidence below 0.7", () => {
    expect(confidenceRing(0.4).low).toBe(true);
    expect(confidenceRing(0.7).low).toBe(false);
  });

  it("clamps out-of-range and non-finite values", () => {
    expect(confidenceRing(5).percent).toBe(100);
    expect(confidenceRing(NaN).percent).toBe(0);
  });
});

describe("urgencyMeter", () => {
  it("maps urgency to a level, label, and tone", () => {
    expect(urgencyMeter("high")).toEqual({ level: 1, label: "High urgency", kind: "alert" });
    expect(urgencyMeter("medium")).toEqual({ level: 0.6, label: "Medium urgency", kind: "warn" });
    expect(urgencyMeter("low")).toEqual({ level: 0.25, label: "Low urgency", kind: "quiet" });
  });

  it("treats unknown urgency as low", () => {
    expect(urgencyMeter("weird").level).toBe(0.25);
  });
});

describe("ledgerChain", () => {
  it("builds one linked block per entry", () => {
    const chain = ledgerChain(3);
    expect(chain.map((b) => b.index)).toEqual([0, 1, 2]);
    expect(chain.every((b) => b.connected && !b.ellipsis)).toBe(true);
  });

  it("caps the drawing and marks the truncation", () => {
    const chain = ledgerChain(50, 10);
    expect(chain).toHaveLength(11);
    expect(chain[9]!.ellipsis).toBe(false);
    expect(chain[10]!.ellipsis).toBe(true);
  });

  it("is empty for no entries", () => {
    expect(ledgerChain(0)).toEqual([]);
  });
});
