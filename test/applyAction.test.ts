import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFileStore } from "../src/storage/fileStore.js";
import { applyAction } from "../src/domain/applyAction.js";
import { buildServer } from "../src/mcp/server.js";
import type { Item } from "../src/domain/model.js";

let store: ReturnType<typeof createFileStore>;
beforeEach(() => { store = createFileStore(mkdtempSync(join(tmpdir(), "wf-"))); });

const item = (over: Partial<Item> = {}): Item => ({
  itemId: "itm_a", scanId: "scn_a", class: "bill", confidence: 0.8, readAloudText: "bill",
  fields: { dueDate: "2026-10-01" },
  proposedActions: [{ actionId: "itm_a:remind", itemId: "itm_a", type: "remind", params: { on: "2026-10-01" }, status: "proposed" }],
  createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null, ...over
});

describe("applyAction", () => {
  it("marks a remind action done and leaves the item unresolved", async () => {
    await store.putItem(item());
    const r = await applyAction(store, "itm_a", "itm_a:remind");
    expect(r.action.status).toBe("done");
    expect(r.item.resolvedAt).toBeNull();
    expect((await store.listActions("itm_a"))[0]!.status).toBe("done");
  });

  it("resolves the item for file and discard", async () => {
    await store.putItem(item({
      proposedActions: [{ actionId: "itm_a:file", itemId: "itm_a", type: "file", params: {}, status: "proposed" }]
    }));
    const r = await applyAction(store, "itm_a", "itm_a:file");
    expect(r.item.resolvedAt).not.toBeNull();
  });

  it("is idempotent for an already-done action", async () => {
    await store.putItem(item({
      proposedActions: [{ actionId: "itm_a:file", itemId: "itm_a", type: "file", params: {}, status: "done" }]
    }));
    const r = await applyAction(store, "itm_a", "itm_a:file");
    expect(r.action.status).toBe("done");
  });

  it("heals a stale action store when the item already mirrors the action as done", async () => {
    await store.putItem(item({
      proposedActions: [{ actionId: "itm_a:file", itemId: "itm_a", type: "file", params: {}, status: "done" }]
    }));
    await store.putAction({ actionId: "itm_a:file", itemId: "itm_a", type: "file", params: {}, status: "proposed" });
    const r = await applyAction(store, "itm_a", "itm_a:file");
    expect(r.action.status).toBe("done");
    expect((await store.listActions("itm_a"))[0]!.status).toBe("done");
  });

  it("refuses share without a trusted contact", async () => {
    await store.putItem(item({
      proposedActions: [{ actionId: "itm_a:share", itemId: "itm_a", type: "share", params: {}, status: "proposed" }]
    }));
    await expect(applyAction(store, "itm_a", "itm_a:share")).rejects.toThrow();
  });

  it("refuses an unknown action", async () => {
    await store.putItem(item());
    await expect(applyAction(store, "itm_a", "itm_a:nope")).rejects.toThrow();
  });
});

async function connect() {
  const s = createFileStore(mkdtempSync(join(tmpdir(), "wf-")));
  const server = buildServer({ store: s });
  const client = new Client({ name: "test", version: "0.0.1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, store: s };
}

describe("act_on_item tool", () => {
  it("returns the spoken message and the updated action on success", async () => {
    const { client, store: s } = await connect();
    await s.putItem(item());
    const res = await client.callTool({ name: "act_on_item", arguments: { itemId: "itm_a", actionId: "itm_a:remind" } });
    const text = (res.content as Array<{ text: string }>)[0]!.text;
    expect(text).toBe("I'll remind you about that.");
    const sc = res.structuredContent as { action: { status: string }; item: Item };
    expect(sc.action.status).toBe("done");
    expect(sc.item.resolvedAt).toBeNull();
    await client.close();
  });

  it("signals isError for an unknown action", async () => {
    const { client, store: s } = await connect();
    await s.putItem(item());
    const res = await client.callTool({ name: "act_on_item", arguments: { itemId: "itm_a", actionId: "itm_a:nope" } });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ text: string }>)[0]!.text;
    expect(text).toBe("I couldn't do that — please choose the action again.");
    expect(text).not.toMatch(/itm_|act_|scn_/);
    expect(text).not.toMatch(/[{}[\]]/);
    await client.close();
  });
});
