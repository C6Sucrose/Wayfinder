import { describe, it, expect } from "vitest";
import { ItemSchema, ActionSchema, LedgerEntrySchema, DocumentStateSchema } from "../src/domain/model.js";

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

describe("v2 model extensions", () => {
  it("parses a legacy item that has no record field", () => {
    const legacy = {
      itemId: "itm_1", scanId: "scn_1", class: "bill", confidence: 0.8,
      readAloudText: "bill", fields: {}, proposedActions: [],
      createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null
    };
    expect(ItemSchema.parse(legacy).record).toBeUndefined();
  });

  it("parses an item carrying a document state", () => {
    const withRecord = {
      itemId: "itm_1", scanId: "scn_1", class: "bill", confidence: 0.8,
      readAloudText: "bill", fields: {}, proposedActions: [],
      createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null,
      record: {
        lifecycle: "awaiting_action", confidence: "low", needsRecapture: true,
        demands: [{ type: "payment", deadline: "2026-10-01" }], threadKey: "t_123"
      }
    };
    const parsed = ItemSchema.parse(withRecord);
    expect(parsed.record?.lifecycle).toBe("awaiting_action");
    expect(parsed.record?.demands[0]!.type).toBe("payment");
  });

  it("rejects an unknown lifecycle", () => {
    expect(() =>
      DocumentStateSchema.parse({ lifecycle: "zombie", confidence: "high", needsRecapture: false, demands: [], threadKey: "t" })
    ).toThrow();
  });

  it("requires a hash chain link on a ledger entry", () => {
    expect(() => LedgerEntrySchema.parse({ seq: 1, entryId: "e1", at: "2026-09-20T00:00:00.000Z", actor: "agent", event: "ingested", details: {} })).toThrow();
  });
});
