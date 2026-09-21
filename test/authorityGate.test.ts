import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../src/storage/fileStore.js";
import { applyAction } from "../src/domain/applyAction.js";
import type { Authority, Item } from "../src/domain/model.js";

let store: ReturnType<typeof createFileStore>;
beforeEach(() => { store = createFileStore(mkdtempSync(join(tmpdir(), "wf-"))); });

const authority: Authority = {
  autoActUpTo: { currency: "EUR", value: 100 },
  confirmAbove: { currency: "EUR", value: 50 },
  forbidden: ["share_personal_data"],
  onLowConfidence: "ask"
};

const item = (over: Partial<Item> = {}): Item => ({
  itemId: "itm_a", scanId: "scn_a", class: "bill", confidence: 0.8, readAloudText: "bill",
  fields: { dueDate: "2026-10-01", amount: { currency: "EUR", value: 60 } },
  proposedActions: [{ actionId: "itm_a:remind", itemId: "itm_a", type: "remind", params: { on: "2026-10-01" }, status: "proposed" }],
  createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null, ...over
});

async function withAuthority() {
  await store.putPreferences({ ...(await store.getPreferences()), authority });
}

describe("applyAction authority gate", () => {
  it("proposes a confirmation-required action without executing it", async () => {
    await store.putItem(item());
    await withAuthority();
    const result = await applyAction(store, "itm_a", "itm_a:remind");
    expect(result.decision).toBe("confirm");
    expect(result.action.status).toBe("proposed");
    expect(await store.listActions("itm_a")).toHaveLength(0);
    expect((await store.listLedger()).map((e) => e.event)).toContain("action_proposed");
  });

  it("executes a confirmation-required action when confirmed", async () => {
    await store.putItem(item());
    await withAuthority();
    const result = await applyAction(store, "itm_a", "itm_a:remind", { confirmed: true });
    expect(result.decision).toBe("confirm");
    expect(result.action.status).toBe("done");
    expect((await store.listLedger()).map((e) => e.event)).toContain("action_confirmed");
  });

  it("refuses a forbidden action and records it without mutating the item", async () => {
    await store.putItem(item({
      proposedActions: [{ actionId: "itm_a:share", itemId: "itm_a", type: "share", params: {}, status: "proposed" }]
    }));
    await withAuthority();
    const result = await applyAction(store, "itm_a", "itm_a:share");
    expect(result.decision).toBe("refuse");
    expect(result.action.status).toBe("proposed");
    expect((await store.listLedger()).map((e) => e.event)).toContain("action_refused");
  });

  it("escalates a low-confidence item when the policy says so", async () => {
    await store.putItem(item({
      record: { lifecycle: "awaiting_action", confidence: "low", needsRecapture: true, demands: [], threadKey: "t_1" }
    }));
    await store.putPreferences({ ...(await store.getPreferences()), authority: { ...authority, onLowConfidence: "escalate" } });
    const result = await applyAction(store, "itm_a", "itm_a:remind");
    expect(result.decision).toBe("escalate");
    expect((await store.listLedger()).map((e) => e.event)).toContain("escalated");
  });

  it("records the receipt before mutating, so a failed receipt leaves state untouched", async () => {
    await store.putItem(item({
      record: { lifecycle: "awaiting_action", confidence: "high", needsRecapture: false, demands: [], threadKey: "t_1" }
    }));
    await withAuthority();
    const flaky = {
      ...store,
      putLedgerEntry: async () => {
        throw new Error("ledger unavailable");
      }
    };
    await expect(applyAction(flaky, "itm_a", "itm_a:remind", { confirmed: true })).rejects.toThrow("ledger unavailable");
    const stored = await store.getItem("itm_a");
    expect(stored?.record?.lifecycle).toBe("awaiting_action");
    expect(stored?.proposedActions[0]?.status).toBe("proposed");
    const events = (await store.listLedger()).map((e) => e.event);
    expect(events).not.toContain("action_confirmed");
    expect(events).not.toContain("action_executed");
  });

  it("records the receipt as an agent action when authority allows it automatically", async () => {
    await store.putItem(item({ fields: { dueDate: "2026-10-01" } }));
    await withAuthority();
    const result = await applyAction(store, "itm_a", "itm_a:remind");
    expect(result.decision).toBe("allow");
    const entry = (await store.listLedger()).find((e) => e.event === "action_executed");
    expect(entry?.actor).toBe("agent");
  });

  it("records the receipt as a user action when the user confirmed", async () => {
    await store.putItem(item());
    await withAuthority();
    await applyAction(store, "itm_a", "itm_a:remind", { confirmed: true });
    const entry = (await store.listLedger()).find((e) => e.event === "action_confirmed");
    expect(entry?.actor).toBe("user");
  });
});
