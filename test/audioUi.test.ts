import { describe, it, expect } from "vitest";
import { normalizeLevel, smoothLevel, historyPoints, cueFor } from "../web/src/audioMath.js";

describe("normalizeLevel", () => {
  it("maps an analyser byte to the unit interval", () => {
    expect(normalizeLevel(0)).toBe(0);
    expect(normalizeLevel(255)).toBe(1);
    expect(normalizeLevel(128)).toBeCloseTo(0.502, 3);
  });

  it("clamps and handles non-finite input", () => {
    expect(normalizeLevel(-5)).toBe(0);
    expect(normalizeLevel(999)).toBe(1);
    expect(normalizeLevel(NaN)).toBe(0);
  });
});

describe("smoothLevel", () => {
  it("rises quickly and falls gently", () => {
    expect(smoothLevel(0, 1)).toBeCloseTo(0.5, 5);
    expect(smoothLevel(1, 0)).toBeCloseTo(0.85, 5);
  });
});

describe("historyPoints", () => {
  it("maps a level history to normalised points", () => {
    expect(historyPoints([0, 0.5, 1], 10, 10)).toEqual([
      { x: 0, y: 10 },
      { x: 5, y: 5 },
      { x: 10, y: 0 }
    ]);
  });

  it("centres a single sample and is empty with no history", () => {
    expect(historyPoints([0.5], 10, 10)).toEqual([{ x: 5, y: 5 }]);
    expect(historyPoints([], 10, 10)).toEqual([]);
  });
});

describe("cueFor", () => {
  it("gives a distinct tone for each state change", () => {
    expect(cueFor("listen-start")).toEqual({ hz: 660, ms: 90 });
    expect(cueFor("listen-stop").hz).toBe(440);
    expect(cueFor("recorded")).toEqual({ hz: 880, ms: 140 });
  });

  it("uses a higher tone to confirm than to acknowledge", () => {
    expect(cueFor("recorded").hz).toBeGreaterThan(cueFor("listen-stop").hz);
  });
});
