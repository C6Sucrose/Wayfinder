import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../../src/storage/fileStore.js";
import { createNotifyQueue } from "../../src/adapters/notifyQueue.js";
import type { Notifier } from "../../src/adapters/types.js";

let store: ReturnType<typeof createFileStore>;
beforeEach(() => { store = createFileStore(mkdtempSync(join(tmpdir(), "wf-"))); });

describe("notifyQueue", () => {
  it("delivers off-path and records an external_invoked entry", async () => {
    const seen: string[] = [];
    const notifier: Notifier = { async notify(input) { seen.push(input.summary); return { delivered: true, detail: "ok" }; } };
    const queue = createNotifyQueue({ notifier, store });
    queue.enqueue({ event: "action_executed", summary: "Filed the water bill" });
    await queue.drain();
    expect(seen).toEqual(["Filed the water bill"]);
    expect((await store.listLedger()).map((e) => e.event)).toEqual(["external_invoked"]);
  });

  it("records delivery_failed when the notifier fails", async () => {
    const notifier: Notifier = { async notify() { return { delivered: false, detail: "boom" }; } };
    const queue = createNotifyQueue({ notifier, store });
    queue.enqueue({ event: "triaged", summary: "x" });
    await queue.drain();
    expect((await store.listLedger()).map((e) => e.event)).toEqual(["delivery_failed"]);
  });

  it("redacts the summary before it reaches the notifier", async () => {
    const seen: string[] = [];
    const notifier: Notifier = { async notify(input) { seen.push(input.summary); return { delivered: true, detail: "ok" }; } };
    const queue = createNotifyQueue({ notifier, store });
    queue.enqueue({ event: "triaged", summary: "Account DE89370400440532013000" });
    await queue.drain();
    expect(seen[0]).not.toContain("DE89370400440532013000");
  });

  it("never throws from enqueue even when delivery fails", async () => {
    const notifier: Notifier = { async notify() { throw new Error("network"); } };
    const queue = createNotifyQueue({ notifier, store });
    expect(() => queue.enqueue({ event: "triaged", summary: "x" })).not.toThrow();
    await queue.drain();
    expect((await store.listLedger()).map((e) => e.event)).toEqual(["delivery_failed"]);
  });
});
