import { describe, it, expect } from "vitest";
import { canonicalJSON, hashEntry, appendLedgerEntry, verifyLedger, buildRecordReport } from "../src/domain/ledger.js";
import type { LedgerEntry } from "../src/domain/model.js";

const base = { entryId: "e", at: "2026-09-20T12:00:00.000Z", actor: "agent" as const };

function chain(): LedgerEntry[] {
  let entries: LedgerEntry[] = [];
  entries = [...entries, appendLedgerEntry(entries, { ...base, entryId: "e1", event: "ingested", documentId: "itm_1", details: { sender: "City Water" } })];
  entries = [...entries, appendLedgerEntry(entries, { ...base, entryId: "e2", event: "triaged", documentId: "itm_1", details: { urgency: "high" } })];
  entries = [...entries, appendLedgerEntry(entries, { ...base, entryId: "e3", event: "action_confirmed", documentId: "itm_1", details: { artifact: "ref-9" } })];
  return entries;
}

describe("canonicalJSON", () => {
  it("sorts keys recursively and emits no whitespace", () => {
    expect(canonicalJSON({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("throws on a value with no JSON representation instead of returning undefined", () => {
    expect(() => canonicalJSON(undefined)).toThrow();
    expect(() => canonicalJSON(() => 0)).toThrow();
  });
});

describe("golden vectors", () => {
  it("pins canonicalJSON for a fixed nested object", () => {
    expect(canonicalJSON({ b: 1, a: { d: 2, c: 3 }, list: [{ y: 2, x: 1 }] })).toBe('{"a":{"c":3,"d":2},"b":1,"list":[{"x":1,"y":2}]}');
  });

  it("pins hashEntry for a fixed prevHash and entry", () => {
    const prevHash = "ab".repeat(32);
    const entry = {
      seq: 1,
      entryId: "e1",
      at: "2026-09-20T12:00:00.000Z",
      actor: "agent" as const,
      event: "ingested" as const,
      details: { sender: "City Water", amount: 42 },
      prevHash
    };
    expect(hashEntry(prevHash, entry)).toBe("7cb9fde86a0529a1680bf3bc7d7ba99b07909c79e1fbb159f9f3afc286158bd8");
  });
});

describe("appendLedgerEntry", () => {
  it("links each entry to the previous hash and numbers the sequence", () => {
    const entries = chain();
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(entries[0]!.prevHash).toBe("0".repeat(64));
    expect(entries[1]!.prevHash).toBe(entries[0]!.hash);
    expect(entries[2]!.prevHash).toBe(entries[1]!.hash);
  });

  it("redacts sensitive details before hashing", () => {
    const entry = appendLedgerEntry([], { ...base, entryId: "e1", event: "ingested", details: { iban: "DE89370400440532013000" } });
    expect(JSON.stringify(entry.details)).not.toContain("DE89370400440532013000");
  });

  it("redacts nested object and array details before hashing and leaves numbers untouched", () => {
    const entry = appendLedgerEntry([], {
      ...base,
      entryId: "e1",
      event: "ingested",
      details: { payment: { iban: "DE89370400440532013000" }, refs: ["DE89370400440532013000"], amount: 84.2 }
    });
    const serialized = JSON.stringify(entry.details);
    expect(serialized).not.toContain("DE89370400440532013000");
    expect(serialized).toContain("••••3000");
    expect(entry.details.amount).toBe(84.2);
    expect(verifyLedger([entry])).toEqual({ ok: true, entries: 1 });
  });

  it("does not mutate the input array", () => {
    const entries = chain();
    const before = entries.length;
    appendLedgerEntry(entries, { ...base, entryId: "e4", event: "closed" });
    expect(entries.length).toBe(before);
  });
});

describe("verifyLedger", () => {
  it("verifies an intact chain", () => {
    const result = verifyLedger(chain());
    expect(result).toEqual({ ok: true, entries: 3 });
  });

  it("detects tampering at the altered sequence number", () => {
    const entries = chain();
    entries[1] = { ...entries[1]!, details: { urgency: "low" } };
    expect(verifyLedger(entries)).toEqual({ ok: false, entries: 3, firstMismatchSeq: 2 });
  });

  it("detects a broken link", () => {
    const entries = chain();
    entries[2] = { ...entries[2]!, prevHash: "f".repeat(64) };
    expect(verifyLedger(entries).firstMismatchSeq).toBe(3);
  });

  it("treats an empty ledger as valid", () => {
    expect(verifyLedger([])).toEqual({ ok: true, entries: 0 });
  });
});

describe("buildRecordReport", () => {
  it("includes every event and the terminal hash", () => {
    const entries = chain();
    const report = buildRecordReport(entries, {});
    expect(report).toContain("ingested");
    expect(report).toContain("action_confirmed");
    expect(report).toContain(entries[entries.length - 1]!.hash);
  });

  it("filters by range", () => {
    const entries = chain();
    const report = buildRecordReport(entries, { from: "2026-09-20T12:00:00.000Z", to: "2026-09-20T12:00:00.000Z" });
    expect(report.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(3);
  });

  it("renders a voice-friendly report with no IDs, JSON, or tool names", () => {
    const entries = chain();
    const report = buildRecordReport(entries, {});
    expect(report).not.toContain("itm_1");
    expect(report).not.toContain("{");
    expect(report).not.toContain("}");
    expect(report.toLowerCase()).not.toContain("verify_ledger");
    expect(report).toContain("sender: City Water");
  });
});
