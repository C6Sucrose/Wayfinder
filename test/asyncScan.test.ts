import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createFileStore } from "../src/storage/fileStore.js";
import { buildServer } from "../src/mcp/server.js";
import { createHttpApp, type HttpDeps } from "../src/server/http.js";
import { createScanWorker } from "../src/scan/worker.js";
import { copy } from "../src/domain/copy.js";
import type { Extractor } from "../src/domain/scanPipeline.js";
import type { Item } from "../src/domain/model.js";

const textOf = (res: unknown) =>
  ((res as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join(" ");

async function connect(extract?: Extractor) {
  const store = createFileStore(mkdtempSync(join(tmpdir(), "wf-async-")));
  const worker = createScanWorker(extract ? { store, extract } : { store });
  const server = buildServer(extract ? { store, extract, worker } : { store, worker });
  const client = new Client({ name: "test", version: "0.0.1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, store, worker };
}

describe("async capture_scan", () => {
  it("returns queued immediately, then get_scan finds items after the worker drains", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const extract = async () => {
      await gate;
      return ["Amount due: €84.20. Payment due 2026-10-01."];
    };
    const { client, worker } = await connect(extract);

    const captured = await client.callTool({ name: "capture_scan", arguments: { imageRefs: ["img"], hint: "mail" } });
    const sc = captured.structuredContent as { scanId: string; status: string; available: boolean };
    expect(sc.status).toBe("queued");
    expect(sc.available).toBe(true);
    expect(textOf(captured)).toBe(copy.scanStarted);

    const interim = await client.callTool({ name: "get_scan", arguments: { scanId: sc.scanId } });
    const interimSc = interim.structuredContent as { status: string; items: Item[] };
    expect(interimSc.status).toBe("queued");
    expect(interimSc.items).toEqual([]);
    expect(textOf(interim)).toBe(copy.scanQueued);

    release();
    await worker.idle();
    const ready = await client.callTool({ name: "get_scan", arguments: { scanId: sc.scanId } });
    const readySc = ready.structuredContent as { status: string; items: Item[] };
    expect(readySc.status).toBe("ready");
    expect(readySc.items).toHaveLength(1);
    expect(readySc.items[0]!.class).toBe("bill");

    await client.close();
    await worker.close();
  });

  it("keeps the reader-unavailable path when no extractor is configured", async () => {
    const { client, store, worker } = await connect();
    const res = await client.callTool({ name: "capture_scan", arguments: { imageRefs: ["x"], hint: "mail" } });
    expect(res.structuredContent).toMatchObject({ available: false, count: 0 });
    expect(textOf(res)).toBe(copy.readerUnavailable);
    expect(await store.listItems("all")).toHaveLength(0);
    await client.close();
    await worker.close();
  });
});

describe("scan completion push", () => {
  it("notifies connected sessions with the ready message when the worker finishes", async () => {
    const store = createFileStore(mkdtempSync(join(tmpdir(), "wf-push-")));
    const extract: Extractor = async () => ["Amount due: €84.20. Payment due 2026-10-01."];
    const deps: HttpDeps = { store, extract };
    const app = createHttpApp(deps);
    const worker = createScanWorker({ store, extract, onComplete: () => app.locals.notifyAll(copy.scanReady) });
    deps.worker = worker;

    const httpServer: Server = app.listen(0);
    await new Promise<void>((resolve) => { httpServer.once("listening", () => resolve()); });
    const addr = httpServer.address();
    const mcpUrl = new URL(`http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/mcp`);

    const client = new Client({ name: "test", version: "0.0.1" });
    let sseReady!: () => void;
    const sseOpened = new Promise<void>((resolve) => { sseReady = resolve; });
    const transport = new StreamableHTTPClientTransport(mcpUrl, {
      fetch: async (url, init) => {
        const response = await fetch(url, init);
        if (init?.method === "GET" && response.ok) sseReady();
        return response;
      }
    });
    await client.connect(transport as unknown as Transport);
    await sseOpened;
    const pushed = new Promise<string>((resolve) => {
      client.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
        resolve(String(n.params.data ?? ""));
      });
    });

    const captured = await client.callTool({ name: "capture_scan", arguments: { imageRefs: ["img"], hint: "mail" } });
    expect((captured.structuredContent as { status?: string }).status).toBe("queued");
    await worker.idle();
    await expect(pushed).resolves.toBe(copy.scanReady);

    await client.close();
    await worker.close();
    await new Promise<void>((resolve) => { httpServer.close(() => resolve()); });
  });
});
