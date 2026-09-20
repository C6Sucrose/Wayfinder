import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFileStore } from "../src/storage/fileStore.js";
import { buildServer } from "../src/mcp/server.js";
import { appendLedgerEntry } from "../src/domain/ledger.js";
import { copy } from "../src/domain/copy.js";
import type { Item } from "../src/domain/model.js";

const item = (over: Partial<Item> = {}): Item => ({
  itemId: "itm_a", scanId: "scn_a", class: "bill", confidence: 0.8, readAloudText: "bill",
  fields: { sender: "City Water", reference: "INV-1", dueDate: "2026-09-22" },
  proposedActions: [], createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null, ...over
});

async function connect() {
  const store = createFileStore(mkdtempSync(join(tmpdir(), "wf-")));
  const server = buildServer({ store });
  const client = new Client({ name: "test", version: "0.0.1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, store };
}

const seed = (store: ReturnType<typeof createFileStore>, documentId: string) => {
  const first = appendLedgerEntry([], { entryId: "e1", at: "2026-09-20T12:00:00.000Z", actor: "agent", event: "ingested", documentId });
  const second = appendLedgerEntry([first], { entryId: "e2", at: "2026-09-20T12:01:00.000Z", actor: "agent", event: "triaged", documentId });
  return { first, second };
};

describe("get_backlog", () => {
  it("speaks the most urgent thread and returns the ranked backlog", async () => {
    const { client, store } = await connect();
    await store.putItem(item());
    const res = await client.callTool({ name: "get_backlog", arguments: { date: "2026-09-20" } });
    const sc = res.structuredContent as { backlog: Array<{ thread: { urgency: string; sender: string } }> };
    expect(sc.backlog[0]!.thread.urgency).toBe("high");
    const text = (res.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("City Water");
    await client.close();
  });
});

describe("get_audit", () => {
  it("returns the events for a document", async () => {
    const { client, store } = await connect();
    const { first, second } = seed(store, "itm_a");
    await store.putLedgerEntry(first);
    await store.putLedgerEntry(second);
    const res = await client.callTool({ name: "get_audit", arguments: { documentId: "itm_a" } });
    const sc = res.structuredContent as { entries: Array<{ event: string }> };
    expect(sc.entries.map((e) => e.event)).toEqual(["ingested", "triaged"]);
    await client.close();
  });

  it("says so when there is nothing recorded", async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: "get_audit", arguments: { documentId: "itm_none" } });
    expect((res.content as Array<{ text: string }>)[0]!.text).toBe(copy.audit.empty);
    await client.close();
  });
});

describe("verify_ledger", () => {
  it("reports an intact chain with the terminal hash", async () => {
    const { client, store } = await connect();
    const { first, second } = seed(store, "itm_a");
    await store.putLedgerEntry(first);
    await store.putLedgerEntry(second);
    const res = await client.callTool({ name: "verify_ledger", arguments: {} });
    const sc = res.structuredContent as { ok: boolean; entries: number; terminal: string };
    expect(sc).toEqual({ ok: true, entries: 2, terminal: second.hash });
    expect((res.content as Array<{ text: string }>)[0]!.text).toContain(second.hash);
    await client.close();
  });

  it("reports the first mismatching sequence number", async () => {
    const { client, store } = await connect();
    const { first, second } = seed(store, "itm_a");
    await store.putLedgerEntry(first);
    await store.putLedgerEntry({ ...second, details: { tampered: true } });
    const res = await client.callTool({ name: "verify_ledger", arguments: {} });
    const sc = res.structuredContent as { ok: boolean; firstMismatchSeq?: number };
    expect(sc.ok).toBe(false);
    expect(sc.firstMismatchSeq).toBe(2);
    await client.close();
  });
});

describe("export_record", () => {
  it("produces a report containing the terminal hash", async () => {
    const { client, store } = await connect();
    const { first, second } = seed(store, "itm_a");
    await store.putLedgerEntry(first);
    await store.putLedgerEntry(second);
    const res = await client.callTool({ name: "export_record", arguments: {} });
    const sc = res.structuredContent as { report: string };
    expect(sc.report).toContain("ingested");
    expect(sc.report).toContain(second.hash);
    await client.close();
  });
});

describe("daily_briefing", () => {
  it("leads with the most urgent thread", async () => {
    const { client, store } = await connect();
    await store.putItem(item());
    const res = await client.callTool({ name: "daily_briefing", arguments: { date: "2026-09-20" } });
    const text = (res.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("City Water");
    expect(text).not.toContain(copy.briefing.clear);
    await client.close();
  });
});

describe("wayfinder://ledger", () => {
  it("is listed and reads back entries with a verification result", async () => {
    const { client, store } = await connect();
    const { first, second } = seed(store, "itm_a");
    await store.putLedgerEntry(first);
    await store.putLedgerEntry(second);
    const list = await client.listResources();
    expect(list.resources.map((r) => r.uri)).toContain("wayfinder://ledger");
    const read = await client.readResource({ uri: "wayfinder://ledger" });
    expect(JSON.stringify(read.contents)).toContain(second.hash);
    await client.close();
  });
});

describe("escalate_item", () => {
  it("records an escalation and moves the document to escalated", async () => {
    const { client, store } = await connect();
    await store.putItem(item({ itemId: "itm_esc" }));
    await store.putPreferences({ ...(await store.getPreferences()), trustedContactAlias: "Priya" });
    const res = await client.callTool({ name: "escalate_item", arguments: { documentId: "itm_esc", reason: "couldn't read it" } });
    expect((res.content as Array<{ text: string }>)[0]!.text).toBe(copy.escalated("Priya"));
    expect((await store.listLedger()).map((e) => e.event)).toContain("escalated");
    expect((await store.getItem("itm_esc"))?.record?.lifecycle).toBe("escalated");
    await client.close();
  });

  it("declines without a trusted contact", async () => {
    const { client, store } = await connect();
    await store.putItem(item({ itemId: "itm_esc" }));
    const res = await client.callTool({ name: "escalate_item", arguments: { documentId: "itm_esc" } });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0]!.text).toBe(copy.noTrustedContact);
    await client.close();
  });

  it("asks for a target when none is given", async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: "escalate_item", arguments: {} });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0]!.text).toBe(copy.escalateTarget);
    await client.close();
  });
});
