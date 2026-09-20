import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFileStore } from "../src/storage/fileStore.js";
import { buildServer } from "../src/mcp/server.js";
import { APP_RESOURCE_URI } from "../src/mcp/appResource.js";

async function connect() {
  const server = buildServer({ store: createFileStore(mkdtempSync(join(tmpdir(), "wf-"))) });
  const client = new Client({ name: "t", version: "0.0.1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("app resource", () => {
  it("lists and reads the MCP App resource with the app MIME type", async () => {
    const client = await connect();
    const list = await client.listResources();
    expect(list.resources.map((r) => r.uri)).toContain(APP_RESOURCE_URI);
    const read = await client.readResource({ uri: APP_RESOURCE_URI });
    const first = read.contents[0] as { mimeType?: string; text?: string };
    expect(first.mimeType).toBe("text/html;profile=mcp-app");
    expect((first.text ?? "").length).toBeGreaterThan(500);
    await client.close();
  });
});
