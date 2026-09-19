import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../src/storage/fileStore.js";
import type { Item, Scan } from "../src/domain/model.js";

const store = createFileStore(mkdtempSync(join(tmpdir(), "wf-sec-")));

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

  it("allows well-formed ids that are absent", async () => {
    await expect(store.getItem("itm_abc123")).resolves.toBeNull();
  });
});
