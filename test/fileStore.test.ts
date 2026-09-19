import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../src/storage/fileStore.js";
import type { Item, Action, Scan, StoredObject } from "../src/domain/model.js";

const unsafeItem: Item = {
  itemId: "../../etc/passwd",
  scanId: "scn_ok",
  class: "junk",
  confidence: 0.1,
  readAloudText: "x",
  fields: {},
  proposedActions: [],
  createdAt: new Date().toISOString(),
  resolvedAt: null
};

const unsafeScan: Scan = {
  scanId: "../evil",
  hint: "auto",
  imageRefs: [],
  status: "queued",
  createdAt: new Date().toISOString()
};

const unsafeObject: StoredObject = {
  objectId: "../../etc/passwd",
  name: "keys",
  locationNote: "somewhere",
  lastSeenAt: new Date().toISOString()
};

const mkItem = (over: Partial<Item> = {}): Item => ({
  itemId: "itm_a", scanId: "scn_a", class: "personal", confidence: 0.5,
  readAloudText: "hello", fields: {}, proposedActions: [],
  createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null, ...over
});
const mkAction = (over: Partial<Action> = {}): Action => ({
  actionId: "itm_a:flag", itemId: "itm_a", type: "flag", params: {}, status: "done", ...over
});

let dir: string;
let store: ReturnType<typeof createFileStore>;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "wf-")); store = createFileStore(dir); });

describe("fileStore id sanitization", () => {
  it("rejects path traversal ids on getItem", async () => {
    await expect(store.getItem("../../etc/passwd")).rejects.toThrow(/invalid id/i);
  });

  it("rejects path traversal ids on getScan", async () => {
    await expect(store.getScan("../../etc/passwd")).rejects.toThrow(/invalid id/i);
  });

  it("rejects unsafe ids on putItem", async () => {
    await expect(store.putItem(unsafeItem)).rejects.toThrow(/invalid id/i);
  });

  it("rejects unsafe ids on putScan", async () => {
    await expect(store.putScan(unsafeScan)).rejects.toThrow(/invalid id/i);
  });

  it("rejects unsafe ids on putObject", async () => {
    await expect(store.putObject(unsafeObject)).rejects.toThrow(/invalid id/i);
  });

  it("allows well-formed ids that are absent", async () => {
    await expect(store.getItem("itm_abc123")).resolves.toBeNull();
  });
});

describe("actions persistence", () => {
  it("round-trips actions per item and upserts by actionId", async () => {
    await store.putAction(mkAction());
    await store.putAction(mkAction({ status: "confirmed" }));
    const list = await store.listActions("itm_a");
    expect(list).toHaveLength(1);
    expect(list[0]!.status).toBe("confirmed");
  });
});

describe("deleteItem", () => {
  it("removes an item and rejects unsafe ids", async () => {
    await store.putItem(mkItem());
    await store.deleteItem("itm_a");
    expect(await store.getItem("itm_a")).toBeNull();
    await expect(store.deleteItem("../../etc/passwd")).rejects.toThrow();
  });
});

describe("listItems filters", () => {
  it("flags scam items and items with a done flag action", async () => {
    await store.putItem(mkItem({ itemId: "itm_x", class: "scam" }));
    await store.putItem(mkItem({ itemId: "itm_b" }));
    await store.putAction(mkAction({ actionId: "itm_b:flag", itemId: "itm_b", status: "done" }));
    const flagged = await store.listItems("flagged");
    expect(flagged.map((i) => i.itemId).sort()).toEqual(["itm_b", "itm_x"]);
  });
  it("excludes resolved items from due", async () => {
    await store.putItem(mkItem({ itemId: "itm_d", fields: { dueDate: "2020-01-01" } }));
    await store.putItem(mkItem({ itemId: "itm_r", fields: { dueDate: "2020-01-01" }, resolvedAt: "2020-01-02T00:00:00.000Z" }));
    const due = await store.listItems("due");
    expect(due.map((i) => i.itemId)).toEqual(["itm_d"]);
  });
});

describe("resilience", () => {
  it("skips a corrupt item file instead of aborting the listing", async () => {
    await store.putItem(mkItem({ itemId: "itm_ok" }));
    mkdirSync(join(dir, "items"), { recursive: true });
    writeFileSync(join(dir, "items", "itm_bad.json"), "{not json", "utf8");
    const all = await store.listItems("all");
    expect(all.map((i) => i.itemId)).toContain("itm_ok");
  });
});
