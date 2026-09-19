import { describe, it, expect } from "vitest";
import { ItemSchema, ActionSchema } from "../src/domain/model.js";

describe("domain model", () => {
  it("accepts a valid item", () => {
    const item = ItemSchema.parse({
      itemId: "itm_1",
      scanId: "scn_1",
      class: "bill",
      confidence: 0.8,
      readAloudText: "A bill from the city.",
      fields: { dueDate: "2026-10-01" },
      proposedActions: [],
      createdAt: "2026-09-19T10:00:00.000Z",
      resolvedAt: null
    });
    expect(item.class).toBe("bill");
  });

  it("rejects an unknown document class", () => {
    expect(() =>
      ItemSchema.parse({
        itemId: "itm_1", scanId: "scn_1", class: "spaceship",
        confidence: 0.5, readAloudText: "x", fields: {},
        proposedActions: [], createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null
      })
    ).toThrow();
  });

  it("rejects a malformed action type", () => {
    expect(() =>
      ActionSchema.parse({ actionId: "a1", itemId: "itm_1", type: "explode", params: {}, status: "proposed" })
    ).toThrow();
  });
});
