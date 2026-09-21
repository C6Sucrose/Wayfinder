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

async function connect() {
  const store = createFileStore(mkdtempSync(join(tmpdir(), "wf-")));
  const adapterConfig = resolveAdapterConfig({});
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
