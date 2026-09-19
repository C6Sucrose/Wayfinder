import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { createFileStore } from "../src/storage/fileStore.js";
import { createHttpApp, isAllowedOrigin, resolveHost } from "../src/server/http.js";

let server: Server;
let base: string;
const initBody = {
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } }
};

beforeAll(async () => {
  const app = createHttpApp({ store: createFileStore(mkdtempSync(join(tmpdir(), "wf-"))), allowedOrigins: ["https://app.example"] });
  await new Promise<void>((r) => { server = app.listen(0, () => { const a = server.address(); base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`; r(); }); });
});
afterAll(() => server.close());

describe("isAllowedOrigin", () => {
  it("allows absent, loopback, and allowlisted origins and rejects others", () => {
    expect(isAllowedOrigin(undefined, [])).toBe(true);
    expect(isAllowedOrigin("http://localhost:5173", [])).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:8080", [])).toBe(true);
    expect(isAllowedOrigin("https://app.example", ["https://app.example"])).toBe(true);
    expect(isAllowedOrigin("https://evil.example", [])).toBe(false);
    expect(isAllowedOrigin("not a url", [])).toBe(false);
  });
});

describe("resolveHost", () => {
  it("defaults to loopback and honors HOST", () => {
    expect(resolveHost({})).toBe("127.0.0.1");
    expect(resolveHost({ HOST: "" })).toBe("127.0.0.1");
    expect(resolveHost({ HOST: "   " })).toBe("127.0.0.1");
    expect(resolveHost({ HOST: "0.0.0.0" })).toBe("0.0.0.0");
  });
});

describe("/mcp origin enforcement", () => {
  it("rejects a disallowed Origin with 403", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify(initBody)
    });
    expect(res.status).toBe(403);
  });
  it("rejects a disallowed Origin even when the body is invalid JSON", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{not json"
    });
    expect(res.status).toBe(403);
  });
  it("accepts a loopback Origin", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", origin: "http://localhost:5173" }, body: JSON.stringify(initBody)
    });
    expect(res.status).not.toBe(403);
  });
});
