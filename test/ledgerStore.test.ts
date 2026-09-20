import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../src/storage/fileStore.js";
import type { LedgerEntry } from "../src/domain/model.js";

const entry = (seq: number): LedgerEntry => ({
  seq, entryId: `led_${seq}`, at: "2026-09-20T12:00:00.000Z", actor: "agent",
  event: "ingested", documentId: "itm_1", details: {},
  prevHash: "0".repeat(64), hash: "h".repeat(64)
});

let dir: string;
let store: ReturnType<typeof createFileStore>;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "wf-")); store = createFileStore(dir); });

describe("ledger persistence", () => {
  it("returns an empty ledger for a fresh store", async () => {
    expect(await store.listLedger()).toEqual([]);
  });

  it("appends entries in order and reads them back", async () => {
    await store.putLedgerEntry(entry(1));
    await store.putLedgerEntry(entry(2));
    expect((await store.listLedger()).map((e) => e.seq)).toEqual([1, 2]);
  });

  it("skips a parseable-but-invalid ledger entry", async () => {
    await store.putLedgerEntry(entry(1));
    writeFileSync(join(dir, "ledger.json"), JSON.stringify([entry(1), {}]), "utf8");
    expect((await store.listLedger()).map((e) => e.seq)).toEqual([1]);
  });
});
