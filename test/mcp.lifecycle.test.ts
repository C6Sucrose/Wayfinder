import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createFileStore } from "../src/storage/fileStore.js";
import { createHttpApp } from "../src/server/http.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = createHttpApp({ store: createFileStore(mkdtempSync(join(tmpdir(), "wf-"))) });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/mcp`;
      resolve();
    });
  });
});

afterAll(() => { server.close(); });

describe("MCP lifecycle", () => {
  it("initializes, lists tools, and calls capture_scan", async () => {
    const client = new Client({ name: "test", version: "0.0.1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(baseUrl)) as unknown as Transport);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("capture_scan");
    const res = await client.callTool({ name: "find_object", arguments: { name: "keys" } });
    expect(res.content).toBeTruthy();
    expect(res.isError !== true).toBe(true);
    await client.close();
  });
});
