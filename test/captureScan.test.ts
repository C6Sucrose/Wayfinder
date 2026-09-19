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
import { createScanWorker } from "../src/scan/worker.js";
import { copy } from "../src/domain/copy.js";
import type { Extractor } from "../src/domain/scanPipeline.js";

const IBAN = "DE89370400440532013000";
const extract: Extractor = async () => [
  `Amount due: €84.20. Payment due 2026-10-01. Account ${IBAN}.`
];

let server: Server;
let baseUrl: string;
let worker: ReturnType<typeof createScanWorker>;

beforeAll(async () => {
  const store = createFileStore(mkdtempSync(join(tmpdir(), "wf-capture-")));
  worker = createScanWorker({ store, extract });
  const app = createHttpApp({ store, extract, worker });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/mcp`;
      resolve();
    });
  });
});

afterAll(async () => {
  await worker.close();
  server.close();
});

const textOf = (res: unknown) =>
  ((res as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join(" ");

describe("capture_scan with an injected extractor", () => {
  it("queues the scan, then reports the masked account number once ready", async () => {
    const client = new Client({ name: "test", version: "0.0.1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(baseUrl)) as unknown as Transport);

    const captured = await client.callTool({
      name: "capture_scan",
      arguments: { imageRefs: ["img1"], hint: "mail" }
    });
    expect(captured.isError !== true).toBe(true);
    const structured = captured.structuredContent as { scanId: string; status: string; available: boolean };
    expect(structured.status).toBe("queued");
    expect(structured.available).toBe(true);
    expect(textOf(captured)).toBe(copy.scanStarted);

    await worker.idle();

    const got = await client.callTool({ name: "get_scan", arguments: { scanId: structured.scanId } });
    expect((got.structuredContent as { status: string }).status).toBe("ready");
    expect(textOf(got)).toContain("••••3000");
    expect(textOf(got)).not.toContain(IBAN);

    await client.close();
  });
});
