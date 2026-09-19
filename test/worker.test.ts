import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../src/storage/fileStore.js";
import { createScan } from "../src/domain/scans.js";
import { createScanWorker } from "../src/scan/worker.js";

let store: ReturnType<typeof createFileStore>;
beforeEach(() => { store = createFileStore(mkdtempSync(join(tmpdir(), "wf-"))); });

describe("scan worker", () => {
  it("processes an enqueued scan and notifies on completion", async () => {
    const completed: string[] = [];
    const worker = createScanWorker({
      store,
      extract: async () => ["Amount due: €10. Payment due 2026-10-01."],
      onComplete: (id) => { completed.push(id); }
    });
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    worker.enqueue({ scanId: scan.scanId, imageRefs: ["a"], hint: "mail" });
    await worker.idle();
    expect((await store.getScan(scan.scanId))?.status).toBe("ready");
    expect((await store.listItems("all")).filter((i) => i.scanId === scan.scanId)).toHaveLength(1);
    expect(completed).toEqual([scan.scanId]);
    await worker.close();
  });

  it("marks a scan failed when the extractor throws and still notifies", async () => {
    const completed: string[] = [];
    const worker = createScanWorker({
      store,
      extract: async () => { throw new Error("bedrock unavailable"); },
      onComplete: (id) => { completed.push(id); }
    });
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    worker.enqueue({ scanId: scan.scanId, imageRefs: ["a"], hint: "mail" });
    await worker.idle();
    expect((await store.getScan(scan.scanId))?.status).toBe("failed");
    expect(completed).toEqual([scan.scanId]);
    await worker.close();
  });

  it("marks a scan failed when no extractor is configured", async () => {
    const worker = createScanWorker({ store });
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    worker.enqueue({ scanId: scan.scanId, imageRefs: ["a"], hint: "mail" });
    await worker.idle();
    expect((await store.getScan(scan.scanId))?.status).toBe("failed");
    await worker.close();
  });

  it("drains queued scans on close without an intervening idle", async () => {
    const completed: string[] = [];
    const worker = createScanWorker({
      store,
      extract: async () => ["Amount due: €10. Payment due 2026-10-01."],
      onComplete: (id) => { completed.push(id); }
    });
    const first = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    const second = await createScan(store, { imageRefs: ["b"], hint: "mail" });
    worker.enqueue({ scanId: first.scanId, imageRefs: ["a"], hint: "mail" });
    worker.enqueue({ scanId: second.scanId, imageRefs: ["b"], hint: "mail" });
    await worker.close();
    const statuses = await Promise.all(
      [first, second].map(async (s) => (await store.getScan(s.scanId))?.status)
    );
    expect(statuses).toEqual(["ready", "ready"]);
    expect(completed).toEqual([first.scanId, second.scanId]);
  }, 15000);

  it("rejects enqueue after close", async () => {
    const worker = createScanWorker({ store });
    await worker.close();
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    expect(() => worker.enqueue({ scanId: scan.scanId, imageRefs: ["a"], hint: "mail" })).toThrow(
      "Worker is closed."
    );
  });
});
