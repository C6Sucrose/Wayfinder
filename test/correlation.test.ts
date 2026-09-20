import { describe, it, expect } from "vitest";
import {
  demandTypeFor, threadKeyFor, isReminderText, isSupersedingText, threadUrgency, toDocumentRecord, buildThreads
} from "../src/domain/correlation.js";
import type { Item } from "../src/domain/model.js";

const now = new Date("2026-09-20T12:00:00.000Z");

const item = (over: Partial<Item> = {}): Item => ({
  itemId: "itm_1", scanId: "scn_1", class: "bill", confidence: 0.8, readAloudText: "bill",
  fields: { sender: "City Water", reference: "INV-1", dueDate: "2026-10-01" },
  proposedActions: [], createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null, ...over
});

describe("demandTypeFor", () => {
  it("maps classes to demand types", () => {
    expect(demandTypeFor("bill")).toBe("payment");
    expect(demandTypeFor("appointment")).toBe("appointment");
    expect(demandTypeFor("insurance")).toBe("reply");
    expect(demandTypeFor("junk")).toBeNull();
    expect(demandTypeFor("scam")).toBeNull();
  });
});

describe("threadKeyFor", () => {
  it("is stable for the same sender, reference, and demand type", () => {
    expect(threadKeyFor({ sender: "City Water", reference: "INV-1" }, "payment")).toBe(threadKeyFor({ sender: "City Water", reference: "INV-1" }, "payment"));
  });
  it("differs when the reference differs", () => {
    expect(threadKeyFor({ sender: "City Water", reference: "INV-1" }, "payment")).not.toBe(threadKeyFor({ sender: "City Water", reference: "INV-2" }, "payment"));
  });
  it("falls back to sender + demand type without a reference", () => {
    expect(threadKeyFor({ sender: "City Water" }, "payment")).toBe(threadKeyFor({ sender: "City Water" }, "payment"));
  });
});

describe("text classifiers", () => {
  it("detects reminder and supersession language", () => {
    expect(isReminderText("This is a second reminder")).toBe(true);
    expect(isReminderText("Final notice before action")).toBe(true);
    expect(isReminderText("Your invoice is attached")).toBe(false);
    expect(isSupersedingText("This replaces our earlier letter")).toBe(true);
    expect(isSupersedingText("Correction to your appointment")).toBe(true);
  });
});

describe("toDocumentRecord", () => {
  it("fills defaults for a legacy item", () => {
    const record = toDocumentRecord(item());
    expect(record.record.lifecycle).toBe("open");
    expect(record.record.confidence).toBe("high");
    expect(record.record.demands[0]!.type).toBe("payment");
    expect(record.record.threadKey.length).toBeGreaterThan(0);
  });
  it("derives closed from resolvedAt, and yields no demands for junk", () => {
    expect(toDocumentRecord(item({ resolvedAt: "2026-09-19T11:00:00.000Z" })).record.lifecycle).toBe("closed");
    expect(toDocumentRecord(item({ class: "junk", fields: {} })).record.demands).toHaveLength(0);
  });
});

describe("threadUrgency", () => {
  it("is high inside three days", () => {
    expect(threadUrgency({ reminderCount: 0, outstanding: true }, "2026-09-22", now)).toBe("high");
  });
  it("is high for two or more reminders on an outstanding thread", () => {
    expect(threadUrgency({ reminderCount: 2, outstanding: true }, "2026-12-01", now)).toBe("high");
  });
  it("is medium inside fourteen days", () => {
    expect(threadUrgency({ reminderCount: 0, outstanding: true }, "2026-10-01", now)).toBe("medium");
  });
  it("is high for two reminders even when the deadline is beyond three days", () => {
    expect(threadUrgency({ reminderCount: 2, outstanding: true }, "2026-09-25", now)).toBe("high");
  });
  it("is low otherwise, and never high once closed", () => {
    expect(threadUrgency({ reminderCount: 0, outstanding: true }, "2027-01-01", now)).toBe("low");
    expect(threadUrgency({ reminderCount: 5, outstanding: false }, "2026-09-21", now)).not.toBe("high");
  });
});

describe("buildThreads", () => {
  it("groups documents, counts reminders, and marks outstanding", () => {
    const a = toDocumentRecord(item({ itemId: "itm_a" }));
    const b = toDocumentRecord(item({ itemId: "itm_b", readAloudText: "Second reminder for your invoice" }));
    const closed = toDocumentRecord(item({ itemId: "itm_c", resolvedAt: "2026-09-19T11:00:00.000Z" }));
    const threads = buildThreads([a, b, closed], now);
    expect(threads).toHaveLength(1);
    const thread = threads[0]!;
    expect(thread.documentIds.sort()).toEqual(["itm_a", "itm_b", "itm_c"]);
    expect(thread.reminderCount).toBe(1);
    expect(thread.outstanding).toBe(true);
    expect(thread.demandType).toBe("payment");
  });
});
