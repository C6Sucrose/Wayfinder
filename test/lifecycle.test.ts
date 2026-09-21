import { describe, it, expect } from "vitest";
import { lifecycleOf, withLifecycle } from "../src/domain/lifecycle.js";
import type { Item } from "../src/domain/model.js";

const item = (over: Partial<Item> = {}): Item => ({
  itemId: "itm_a", scanId: "scn_a", class: "bill", confidence: 0.8, readAloudText: "bill",
  fields: {}, proposedActions: [], createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null, ...over
});

describe("lifecycleOf", () => {
  it("derives open for a legacy unresolved item", () => {
    expect(lifecycleOf(item())).toBe("open");
  });
  it("derives closed from a legacy resolvedAt", () => {
    expect(lifecycleOf(item({ resolvedAt: "2026-09-19T11:00:00.000Z" }))).toBe("closed");
  });
  it("reads the stored record when present", () => {
    const record = { lifecycle: "action_taken" as const, confidence: "high" as const, needsRecapture: false, demands: [], threadKey: "t" };
    expect(lifecycleOf(item({ record }))).toBe("action_taken");
  });
});

describe("withLifecycle", () => {
  it("sets resolvedAt exactly when first closing", () => {
    const closed = withLifecycle(item(), "closed", "2026-09-20T12:00:00.000Z");
    expect(closed.resolvedAt).toBe("2026-09-20T12:00:00.000Z");
    expect(closed.record?.lifecycle).toBe("closed");
  });
  it("does not set resolvedAt for a non-closing state", () => {
    expect(withLifecycle(item(), "action_taken", "2026-09-20T12:00:00.000Z").resolvedAt).toBeNull();
  });
  it("preserves an existing resolvedAt", () => {
    const again = withLifecycle(item({ resolvedAt: "2026-01-01T00:00:00.000Z" }), "closed", "2026-09-20T12:00:00.000Z");
    expect(again.resolvedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
