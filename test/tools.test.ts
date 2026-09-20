import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFileStore } from "../src/storage/fileStore.js";
import { buildServer } from "../src/mcp/server.js";
import { APP_RESOURCE_URI } from "../src/mcp/appResource.js";
import { copy } from "../src/domain/copy.js";
import type { Item } from "../src/domain/model.js";

const item = (over: Partial<Item> = {}): Item => ({
  itemId: "itm_x", scanId: "scn_x", class: "personal", confidence: 0.7, readAloudText: "hello",
  fields: {}, proposedActions: [], createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null, ...over
});

async function connect(extract?: Parameters<typeof buildServer>[0]["extract"]) {
  const store = createFileStore(mkdtempSync(join(tmpdir(), "wf-")));
  const server = buildServer(extract ? { store, extract } : { store });
  const client = new Client({ name: "test", version: "0.0.1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, store };
}

describe("capture_scan without an extractor", () => {
  it("reports reading unavailable instead of a blurry-image failure and writes no scan", async () => {
    const { client, store } = await connect();
    const res = await client.callTool({ name: "capture_scan", arguments: { imageRefs: ["x"], hint: "mail" } });
    const sc = res.structuredContent as { available: boolean; count: number };
    expect(sc.available).toBe(false);
    expect(sc.count).toBe(0);
    expect(JSON.stringify(res.content)).toContain(copy.readerUnavailable.slice(0, 20));
    expect(await store.listItems("all")).toHaveLength(0);
    await client.close();
  });
});

describe("label disclaimer", () => {
  it("appends the disclaimer when reading a label item", async () => {
    const { client, store } = await connect();
    await store.putItem(item({
      itemId: "itm_lab", class: "label", confidence: 0.9, readAloudText: "Ibuprofen 400mg"
    }));
    const res = await client.callTool({ name: "get_item", arguments: { itemId: "itm_lab" } });
    expect(JSON.stringify(res.content)).toContain(copy.disclaimers.label);
    await client.close();
  });
});

describe("get_item error safety", () => {
  it("does not leak internal error text for an unsafe id", async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: "get_item", arguments: { itemId: "../../etc/passwd" } });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ text: string }>).map((c) => c.text).join(" ");
    expect(text).not.toContain("Invalid id");
    expect(text).not.toMatch(/itm_/);
    expect(text).not.toMatch(/[\\/]/);
    expect(text).toContain(copy.toolUnavailable);
    expect(text).not.toContain(copy.toolFailed);
    await client.close();
  });
});

describe("act_on_item error copy", () => {
  it("keeps the action-specific message", async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: "act_on_item", arguments: { itemId: "../../etc/passwd", actionId: "x" } });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ text: string }>).map((c) => c.text).join(" ");
    expect(text).toContain(copy.toolFailed);
    await client.close();
  });
});

describe("identify_product read-back", () => {
  it("speaks the full label text including detail lines, then the disclaimer", async () => {
    const extract = async () => ["Ibuprofen 400mg\nBest before 2028-01\nContains lactose"];
    const { client } = await connect(extract);
    const res = await client.callTool({ name: "identify_product", arguments: { imageRefs: ["x"] } });
    const text = (res.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("Best before");
    expect(text).toContain("Contains lactose");
    expect(text).toContain(copy.disclaimers.label);
    await client.close();
  });
});

describe("daily_briefing", () => {
  it("returns every category and counts them truthfully", async () => {
    const { client, store } = await connect();
    await store.putItem(item({ itemId: "itm_due", fields: { dueDate: "2026-09-01" } }));
    await store.putItem(item({ itemId: "itm_appt", class: "appointment", fields: { appointmentAt: "2026-09-25T09:00:00.000Z" } }));
    await store.putItem(item({ itemId: "itm_scam", class: "scam" }));
    await store.putObject({ objectId: "obj_k", name: "keys", locationNote: "entry table", lastSeenAt: "2026-09-19T10:00:00.000Z" });

    const res = await client.callTool({ name: "daily_briefing", arguments: { date: "2026-09-19" } });
    const sc = res.structuredContent as { due: Item[]; appointments: Item[]; flagged: Item[]; objectReminders: unknown[] };
    expect(sc.due.map((i) => i.itemId)).toEqual(["itm_due"]);
    expect(sc.appointments.map((i) => i.itemId)).toEqual(["itm_appt"]);
    expect(sc.flagged.map((i) => i.itemId)).toContain("itm_scam");
    expect(sc.objectReminders).toHaveLength(1);

    const text = (res.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("1 due");
    expect(text).toContain("1 appointment(s)");
    expect(text).toContain("1 flagged");
    expect(text).toContain("1 reminder(s)");
    await client.close();
  });

  it("uses the supplied date as the due reference", async () => {
    const { client, store } = await connect();
    await store.putItem(item({ itemId: "itm_later", fields: { dueDate: "2026-09-20" } }));

    const before = await client.callTool({ name: "daily_briefing", arguments: { date: "2026-09-19" } });
    expect((before.structuredContent as { due: Item[] }).due).toHaveLength(0);

    const on = await client.callTool({ name: "daily_briefing", arguments: { date: "2026-09-20" } });
    expect((on.structuredContent as { due: Item[] }).due.map((i) => i.itemId)).toEqual(["itm_later"]);
    await client.close();
  });

  it("rejects a non-ISO date with a safe customer message", async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: "daily_briefing", arguments: { date: "tomorrow" } });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ text: string }>)[0]!.text;
    expect(text).toBe(copy.invalidDate);
    expect(text).not.toMatch(/itm_|scn_|https?:|[{}]/);
    expect(res.structuredContent).toBeUndefined();
    await client.close();
  });

  it("is sensible when only object reminders exist", async () => {
    const { client, store } = await connect();
    await store.putObject({ objectId: "obj_k", name: "keys", locationNote: "entry table", lastSeenAt: "2026-09-19T10:00:00.000Z" });

    const res = await client.callTool({ name: "daily_briefing", arguments: { date: "2026-09-19" } });
    const text = (res.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("1 reminder(s)");
    expect(text).not.toContain("0 due");
    expect(text).not.toContain("0 flagged");
    await client.close();
  });
});

describe("update_preferences", () => {
  it("merges a patch into preferences", async () => {
    const { client, store } = await connect();
    await client.callTool({ name: "update_preferences", arguments: { verbosity: "brief" } });
    expect((await store.getPreferences()).verbosity).toBe("brief");
    await client.close();
  });
});

describe("resources and prompt", () => {
  it("lists the app, inbox, and objects resources and reads the inbox", async () => {
    const { client, store } = await connect();
    await store.putItem({
      itemId: "itm_i", scanId: "scn_x", class: "bill", confidence: 0.8, readAloudText: "bill",
      fields: {}, proposedActions: [], createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null
    });
    const list = await client.listResources();
    expect(list.resources.map((r) => r.uri).sort()).toEqual([APP_RESOURCE_URI, "wayfinder://inbox", "wayfinder://ledger", "wayfinder://objects"]);
    const read = await client.readResource({ uri: "wayfinder://inbox" });
    expect(JSON.stringify(read.contents)).toContain("itm_i");
    await client.close();
  });

  it("exposes the morning_briefing prompt", async () => {
    const { client } = await connect();
    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((p) => p.name)).toContain("morning_briefing");
    const got = await client.getPrompt({ name: "morning_briefing" });
    expect(got.messages.length).toBeGreaterThan(0);
    expect(JSON.stringify(got.messages)).toContain(copy.prompts.morningBriefing);
    await client.close();
  });
});

describe("list_items voice-first", () => {
  it("speaks each item's read-aloud text", async () => {
    const { client, store } = await connect();
    await store.putItem(item({
      itemId: "itm_voice", readAloudText: "Distinctive read-aloud sentence for the list."
    }));
    const res = await client.callTool({ name: "list_items", arguments: { filter: "all" } });
    const text = (res.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("Distinctive read-aloud sentence for the list.");
    await client.close();
  });
});
