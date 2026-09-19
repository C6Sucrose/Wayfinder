import { describe, it, expect } from "vitest";
import { copy } from "../src/domain/copy.js";

describe("smoke", () => {
  it("exposes user-facing copy", () => {
    expect(copy.scanStarted.length).toBeGreaterThan(0);
  });
});
