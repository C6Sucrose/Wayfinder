import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../src/storage/fileStore.js";
import { buildBacklog, describeThread } from "../src/domain/backlog.js";
import type { Item } from "../src/domain/model.js";

const now = new Date("2026-09-20T12:00:00.000Z");

let store: ReturnType<typeof createFileStore>;
beforeEach(() => { store = createFileStore(mkdtempSync(join(tmpdir(), "wf-"))); });

const item = (over: Partial<Item> = {}): Item => ({
  itemId: "itm_a", scanId: "scn_a", class: "bill", confidence: 0.8, readAloudText: "bill",
  fields: { sender: "City Water", reference: "INV-1", dueDate: "2026-09-22" },
  proposedActions: [], createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null, ...over
});

describe("buildBacklog", () => {
  it("returns an empty backlog for a fresh store", async () => {
    expect(await buildBacklog(store, now)).toEqual([]);
  });

  it("ranks an outstanding high-urgency thread first", async () => {
    await store.putItem(item({ itemId: "itm_high" }));
    await store.putItem(item({ itemId: "itm_far", fields: { sender: "Bank", reference: "B-1", dueDate: "2027-06-01" } }));
    const backlog = await buildBacklog(store, now);
    expect(backlog).toHaveLength(2);
    expect(backlog[0]!.thread.urgency).toBe("high");
    expect(backlog[0]!.deadline).toBe("2026-09-22");
  });

  it("does not treat a closed thread as outstanding", async () => {
    await store.putItem(item({ itemId: "itm_closed", resolvedAt: "2026-09-19T11:00:00.000Z" }));
    expect((await buildBacklog(store, now))[0]!.thread.outstanding).toBe(false);
  });
});

describe("describeThread", () => {
  it("names the sender, demand, deadline, and reminders", () => {
    const text = describeThread(
      { threadKey: "t", sender: "City Water", demandType: "payment", documentIds: [], firstSeenAt: "", lastSeenAt: "", reminderCount: 2, urgency: "high", outstanding: true },
      "2026-09-22"
    );
    expect(text).toContain("City Water");
    expect(text).toContain("payment");
    expect(text).toContain("2026-09-22");
    expect(text).toContain("2 reminder(s)");
  });

  it("uses the article 'an' for an appointment", () => {
    const text = describeThread(
      { threadKey: "t", sender: "Clinic", demandType: "appointment", documentIds: [], firstSeenAt: "", lastSeenAt: "", reminderCount: 0, urgency: "medium", outstanding: true }
    );
    expect(text).toContain("an appointment");
  });
});
