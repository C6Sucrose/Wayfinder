import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../src/storage/fileStore.js";
import { runScan } from "../src/domain/scanPipeline.js";

let store: ReturnType<typeof createFileStore>;
beforeEach(() => { store = createFileStore(mkdtempSync(join(tmpdir(), "wf-"))); });

describe("runScan", () => {
  it("classifies text into items with proposed actions", async () => {
    const scan = await runScan(store, {
      imageRefs: ["img1"],
      hint: "mail",
      extractedText: ["Amount due: €84.20. Payment due 2026-10-01."]
    });
    expect(scan.status).toBe("ready");
    const items = await store.listItems("all");
    expect(items.length).toBe(1);
    expect(items[0]!.class).toBe("bill");
    expect(items[0]!.proposedActions.map((a) => a.type)).toContain("remind");
  });
});
