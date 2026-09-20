import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../src/storage/fileStore.js";
import { createLedger } from "../src/domain/ledgerLog.js";

let store: ReturnType<typeof createFileStore>;
beforeEach(() => { store = createFileStore(mkdtempSync(join(tmpdir(), "wf-"))); });

const input = (event: "ingested" | "triaged" | "closed") => ({
  at: "2026-09-20T12:00:00.000Z", actor: "agent" as const, event
});

describe("createLedger", () => {
  it("numbers and links entries as it appends", async () => {
    const ledger = createLedger(store);
    await ledger.append(input("ingested"));
    await ledger.append(input("triaged"));
    const entries = await ledger.read();
    expect(entries.map((e) => e.seq)).toEqual([1, 2]);
    expect(entries[1]!.prevHash).toBe(entries[0]!.hash);
    expect((await ledger.verify()).ok).toBe(true);
  });

  it("serializes concurrent appends into one intact chain", async () => {
    const ledger = createLedger(store);
    await Promise.all([
      ledger.append(input("ingested")),
      ledger.append(input("triaged")),
      ledger.append(input("closed")),
      ledger.append(input("ingested")),
      ledger.append(input("triaged"))
    ]);
    const result = await ledger.verify();
    expect(result).toEqual({ ok: true, entries: 5 });
  });

  it("returns the same instance for the same store", () => {
    expect(createLedger(store)).toBe(createLedger(store));
  });

  it("keeps appending after a failed write", async () => {
    let failNext = true;
    const flaky = {
      listLedger: () => store.listLedger(),
      putLedgerEntry: async (e: Parameters<typeof store.putLedgerEntry>[0]) => {
        if (failNext) { failNext = false; throw new Error("disk hiccup"); }
        return store.putLedgerEntry(e);
      }
    };
    const ledger = createLedger(flaky);
    await expect(ledger.append(input("ingested"))).rejects.toThrow();
    await ledger.append(input("triaged"));
    const entries = await ledger.read();
    expect(entries.map((e) => e.seq)).toEqual([1]);
    expect((await ledger.verify()).ok).toBe(true);
  });
});
