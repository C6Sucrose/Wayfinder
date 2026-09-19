import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFileStore } from "../src/storage/fileStore.js";
import { buildServer } from "../src/mcp/server.js";
import { APP_RESOURCE_URI, UI_TOOLS } from "../src/mcp/appResource.js";

describe("UI tool metadata", () => {
  it("exposes _meta.ui.resourceUri on exactly the display tools", async () => {
    const server = buildServer({ store: createFileStore(mkdtempSync(join(tmpdir(), "wf-"))) });
    const client = new Client({ name: "t", version: "0.0.1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const { tools } = await client.listTools();
    for (const name of UI_TOOLS) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      const ui = (tool!._meta as { ui?: { resourceUri?: string } } | undefined)?.ui;
      expect(ui?.resourceUri, name).toBe(APP_RESOURCE_URI);
    }
    await client.close();
  });
});
