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
});
