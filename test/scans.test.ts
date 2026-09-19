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

  it("marks the scan failed and persists nothing when a text cannot be processed", async () => {
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

  it("marks a scan failed when given no text", async () => {
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    const done = await processScan(store, scan.scanId, []);
    expect(done.status).toBe("failed");
  });
});
