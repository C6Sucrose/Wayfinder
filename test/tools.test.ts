import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFileStore } from "../src/storage/fileStore.js";
import { buildServer } from "../src/mcp/server.js";
import { copy } from "../src/domain/copy.js";

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
