import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFileStore } from "../src/storage/fileStore.js";
import { buildServer } from "../src/mcp/server.js";
import { createHttpApp } from "../src/server/http.js";
import { createAdapters } from "../src/adapters/registry.js";
import { resolveAdapterConfig } from "../src/adapters/config.js";
import { createNotifyQueue } from "../src/adapters/notifyQueue.js";

async function connect(env: NodeJS.ProcessEnv = {}) {
  const store = createFileStore(mkdtempSync(join(tmpdir(), "wf-")));
  const adapterConfig = resolveAdapterConfig(env);
  const server = buildServer({ store, adapterConfig, adapters: createAdapters(adapterConfig) });
  const client = new Client({ name: "t", version: "0.0.1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, store };
}

describe("capability disclosure", () => {
  it("reports null for every unconfigured port on the MCP resource", async () => {
    const { client } = await connect();
    const read = await client.readResource({ uri: "wayfinder://capabilities" });
    const body = JSON.parse((read.contents[0] as { text: string }).text) as {
      adapters: Record<string, string>;
      chain: { head: string; verified: boolean };
    };
    expect(body.adapters).toEqual({ notifier: "null", calendar: "null", payment: "null", signature: "local", documentSource: "null", assist: "null" });
    expect(body.chain.verified).toBe(true);
    await client.close();
  });

  it("serves the same on GET /capabilities", async () => {
    const store = createFileStore(mkdtempSync(join(tmpdir(), "wf-")));
    const adapterConfig = resolveAdapterConfig({});
    const app = createHttpApp({ store, adapterConfig });
    const server = app.listen(0);
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const res = await fetch(`http://127.0.0.1:${port}/capabilities`);
      expect(res.status).toBe(200);
      const body = await res.json() as { adapters: Record<string, string> };
      expect(body.adapters.notifier).toBe("null");
    } finally {
      server.close();
    }
  });
});

describe("prepare_payment", () => {
  it("prepares an EPC payload and records the handoff, never a payment", async () => {
    const { client, store } = await connect({ WAYFINDER_ADAPTER_PAYMENT: "epc" });
    const res = await client.callTool({
      name: "prepare_payment",
      arguments: {
        beneficiaryName: "City Water",
        iban: "DE89370400440532013000",
        amount: { currency: "EUR", value: 12.5 },
        remittance: "INV-1",
        documentId: "itm_a"
      }
    });
    const sc = res.structuredContent as { epcQr?: string };
    expect(typeof sc.epcQr).toBe("string");
    const events = (await store.listLedger()).map((e) => e.event);
    expect(events).toContain("action_proposed");
    expect(JSON.stringify(await store.listLedger())).not.toContain("DE89370400440532013000");
    await client.close();
  });

  it("refuses an invalid IBAN", async () => {
    const { client } = await connect({ WAYFINDER_ADAPTER_PAYMENT: "epc" });
    const res = await client.callTool({
      name: "prepare_payment",
      arguments: {
        beneficiaryName: "City Water",
        iban: "DE89370400440532013001",
        amount: { currency: "EUR", value: 12.5 },
        remittance: "INV-1"
      }
    });
    expect(res.isError).toBe(true);
    await client.close();
  });

  it("enqueues a notification after an allowed action", async () => {
    const store = createFileStore(mkdtempSync(join(tmpdir(), "wf-")));
    const seen: string[] = [];
    const notify = createNotifyQueue({
      notifier: { async notify(input) { seen.push(input.event); return { delivered: true, detail: "ok" }; } },
      store
    });
    const adapterConfig = resolveAdapterConfig({});
    const server = buildServer({ store, adapterConfig, adapters: createAdapters(adapterConfig), notify });
    const client = new Client({ name: "t", version: "0.0.1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    await store.putItem({
      itemId: "itm_n", scanId: "scn_n", class: "bill", confidence: 0.8, readAloudText: "bill",
      fields: { dueDate: "2026-10-01" },
      proposedActions: [{ actionId: "itm_n:remind", itemId: "itm_n", type: "remind", params: { on: "2026-10-01" }, status: "proposed" }],
      createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null
    });
    await client.callTool({ name: "act_on_item", arguments: { itemId: "itm_n", actionId: "itm_n:remind" } });
    await notify.drain();
    expect(seen).toContain("action_executed");
    await client.close();
  });
});
