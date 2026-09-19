import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createFileStore } from "../src/storage/fileStore.js";
import { createHttpApp } from "../src/server/http.js";

const serverState = vi.hoisted(() => ({ count: 0 }));

vi.mock("../src/mcp/server.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/mcp/server.js")>();
  return {
    ...actual,
    buildServer: (...args: Parameters<typeof actual.buildServer>) => {
      serverState.count += 1;
      return actual.buildServer(...args);
    }
  };
});

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
  it("initializes, lists tools, and calls tools with safe customer-facing text", async () => {
    const client = new Client({ name: "test", version: "0.0.1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(baseUrl)) as unknown as Transport);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("capture_scan");

    const saved = await client.callTool({
      name: "remember_object",
      arguments: { name: "keys", locationNote: "on the kitchen counter" }
    });
    expect(saved.isError !== true).toBe(true);
    expect(saved.structuredContent).toBeTruthy();

    const res = await client.callTool({ name: "find_object", arguments: { name: "keys" } });
    expect(res.isError !== true).toBe(true);
    expect(res.structuredContent).toBeTruthy();

    const text = (res.content as Array<{ type: string; text?: string }>)
      .map((c) => c.text ?? "").join(" ");
    expect(text).toContain("kitchen counter");
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/\{"|\[\{/);
    expect(text).not.toMatch(/\b(?:capture_scan|get_scan|find_object|remember_object)\b/);

    await client.close();
  });

  it("rejects requests with no session id without spawning a server", async () => {
    const before = serverState.count;

    const getRes = await fetch(baseUrl, { method: "GET" });
    expect(getRes.status).toBe(400);

    const postRes = await fetch(baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    });
    expect(postRes.status).toBe(400);

    expect(serverState.count).toBe(before);
  });
});
