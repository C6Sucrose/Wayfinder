import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../src/storage/fileStore.js";
import { createScan, processScan } from "../src/domain/scans.js";

let store: ReturnType<typeof createFileStore>;
beforeEach(() => { store = createFileStore(mkdtempSync(join(tmpdir(), "wf-"))); });

describe("createScan", () => {
  it("persists a queued scan with no items", async () => {
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    expect(scan.status).toBe("queued");
    expect((await store.listItems("all")).filter((i) => i.scanId === scan.scanId)).toHaveLength(0);
    expect((await store.getScan(scan.scanId))?.status).toBe("queued");
  });
});

describe("processScan", () => {
  it("classifies texts into items and marks the scan ready", async () => {
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    const done = await processScan(store, scan.scanId, ["Amount due: €10. Payment due 2026-10-01."]);
    expect(done.status).toBe("ready");
    const items = (await store.listItems("all")).filter((i) => i.scanId === scan.scanId);
    expect(items).toHaveLength(1);
    expect(items[0]!.class).toBe("bill");
  });

  it("marks the scan failed and rolls back when persisting an item fails", async () => {
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    const real = store;
    const flaky = {
      ...real,
      putItem: async () => { throw new Error("disk full"); }
    } as typeof real;
    const done = await processScan(flaky, scan.scanId, ["Amount due: €10."]);
    expect(done.status).toBe("failed");
    expect((await real.listItems("all")).filter((i) => i.scanId === scan.scanId)).toHaveLength(0);
  });

  it("marks the scan failed without items when analysis throws", async () => {
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    const done = await processScan(store, scan.scanId, [null as unknown as string]);
    expect(done.status).toBe("failed");
    expect((await store.listItems("all")).filter((i) => i.scanId === scan.scanId)).toHaveLength(0);
  });

  it("marks a scan failed when given no text", async () => {
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    const done = await processScan(store, scan.scanId, []);
    expect(done.status).toBe("failed");
  });

  it("is idempotent when re-invoked on a ready scan", async () => {
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    const texts = ["Amount due: €10. Payment due 2026-10-01."];
    const first = await processScan(store, scan.scanId, texts);
    expect(first.status).toBe("ready");
    const second = await processScan(store, scan.scanId, texts);
    expect(second.status).toBe("ready");
    expect(second).toEqual(first);
    expect((await store.listItems("all")).filter((i) => i.scanId === scan.scanId)).toHaveLength(1);
  });

  it("returns an already-failed scan unchanged and writes no items", async () => {
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    const failed = await processScan(store, scan.scanId, []);
    expect(failed.status).toBe("failed");
    const again = await processScan(store, scan.scanId, ["Amount due: €10. Payment due 2026-10-01."]);
    expect(again).toEqual(failed);
    expect((await store.listItems("all")).filter((i) => i.scanId === scan.scanId)).toHaveLength(0);
  });

  it("coalesces concurrent runs for the same scan so items are not duplicated", async () => {
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    const texts = ["Amount due: €10. Payment due 2026-10-01."];
    const [first, second] = await Promise.all([
      processScan(store, scan.scanId, texts),
      processScan(store, scan.scanId, texts)
    ]);
    expect(first.status).toBe("ready");
    expect(second.status).toBe("ready");
    expect(second).toEqual(first);
    expect((await store.listItems("all")).filter((i) => i.scanId === scan.scanId)).toHaveLength(1);
  });

  it("replaces stale items from a prior attempt instead of duplicating them", async () => {
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    const texts = ["Amount due: €10. Payment due 2026-10-01."];
    await processScan(store, scan.scanId, texts);
    await store.putScan({ ...scan, status: "analyzing" });
    const retried = await processScan(store, scan.scanId, texts);
    expect(retried.status).toBe("ready");
    expect((await store.listItems("all")).filter((i) => i.scanId === scan.scanId)).toHaveLength(1);
  });
});

describe("processScan records and ledger", () => {
  it("persists a document record and appends ingested then triaged", async () => {
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    await processScan(store, scan.scanId, ["Hello, please look at this letter."]);
    const item = (await store.listItems("all")).find((i) => i.scanId === scan.scanId)!;
    expect(item.record?.lifecycle).toBe("open");
    expect(item.record?.threadKey).toMatch(/^t_/);
    expect((await store.listLedger()).map((e) => e.event)).toEqual(["ingested", "triaged"]);
  });

  it("marks a low-confidence read as awaiting recapture", async () => {
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    await processScan(store, scan.scanId, ["Hello, account DE89370400440532013001."]);
    const item = (await store.listItems("all")).find((i) => i.scanId === scan.scanId)!;
    expect(item.record?.confidence).toBe("low");
    expect(item.record?.needsRecapture).toBe(true);
    expect(item.record?.lifecycle).toBe("awaiting_action");
  });

  it("still marks the scan ready when the ledger cannot be written", async () => {
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    const flaky = { ...store, putLedgerEntry: async () => { throw new Error("ledger down"); } } as typeof store;
    const done = await processScan(flaky, scan.scanId, ["Hello there."]);
    expect(done.status).toBe("ready");
  });
});
