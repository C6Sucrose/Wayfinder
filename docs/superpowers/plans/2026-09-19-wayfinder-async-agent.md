# Wayfinder — Plan 3: Async Scan Worker, Bedrock Extractor & Agent Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make image reading asynchronous (so `capture_scan` returns inside the 500 ms budget), wire a real Amazon Bedrock multimodal extractor behind the existing seam, and add the agent brain (Bedrock Converse tool-use loop over a real MCP client, with a deterministic rule-brain fallback) plus the `POST /api/agent` endpoint the simulated client will use.

**Architecture:** Plan 1/2 built a synchronous deterministic pipeline and a sessionful MCP server. Plan 3 splits scan creation from processing: `createScan` enqueues, a worker processes out-of-band, and the server pushes `notifications/message` on completion. The Bedrock extractor implements the existing `Extractor` type, so no handler ever performs model I/O. The agent layer is a separate module that talks to the MCP server over its own real MCP client — never shortcuts into the domain.

**Tech Stack:** Node 22+ ESM, TypeScript 5, `@modelcontextprotocol/sdk`, `@aws-sdk/client-bedrock-runtime`, `zod`, `express`, `vitest`.

**Spec:** `docs/superpowers/specs/2026-09-19-wayfinder-design.md`

## Global Constraints

- Node **22+**; ESM (`"type": "module"`).
- MCP spec **`2025-11-25`**, **Streamable HTTP**, sessionful.
- **Tool handlers return in < 500 ms — no model or network I/O inside a handler.** All Bedrock work runs in the async worker or the agent layer.
- Domain core is **pure**; Bedrock code lives behind injected interfaces.
- Customer text: no IDs, URLs, JSON, or tool names. All spoken strings live in `src/domain/copy.ts`.
- No medical/financial advice; account numbers masked.
- Everything must work **without AWS credentials** (rule-brain + no-extractor paths); Bedrock is additive.
- Bedrock is not yet enabled on the account (use-case form pending) — every Bedrock path is dependency-injected so tests never call AWS.

---

## File Structure

```
src/domain/scans.ts          CREATE createScan + processScan (split of runScan)
src/domain/scanPipeline.ts   MODIFY runScan composes createScan + processScan
src/scan/worker.ts           CREATE in-process scan queue with drain + close
src/scan/bedrockExtractor.ts CREATE Bedrock multimodal Extractor (injected client)
src/scan/imageSource.ts      CREATE imageRef -> bytes loader (file path or data URL)
src/agent/mcpExecutor.ts     CREATE MCP client wrapper (listTools -> Bedrock specs, callTool)
src/agent/bedrockBrain.ts    CREATE Converse tool-use loop (injected client + executor)
src/agent/ruleBrain.ts       CREATE deterministic intent router
src/agent/service.ts         CREATE brain selection + handleUtterance
src/mcp/server.ts            MODIFY capture_scan async + get_scan status + push on completion
src/server/http.ts           MODIFY session registry, worker wiring, POST /api/agent
src/server/index.ts          MODIFY construct extractor/worker/brain from env
src/domain/copy.ts           MODIFY add interim/analysis strings
package.json                 MODIFY add @aws-sdk/client-bedrock-runtime
test/scans.test.ts           CREATE createScan/processScan
test/worker.test.ts          CREATE queue drain/ordering/failure
test/bedrockExtractor.test.ts CREATE injected-client request/response + failure
test/imageSource.test.ts     CREATE file + data-URL loading
test/mcpExecutor.test.ts     CREATE tool-spec conversion + callTool
test/bedrockBrain.test.ts    CREATE tool-use round trip with fakes
test/ruleBrain.test.ts       CREATE intent routing
test/agentService.test.ts    CREATE brain selection + handleUtterance
test/asyncScan.test.ts       CREATE capture_scan async + get_scan status
```

---

### Task 1: Split scan creation from processing

**Files:**
- Create: `src/domain/scans.ts`
- Modify: `src/domain/scanPipeline.ts`
- Test: `test/scans.test.ts`

**Interfaces:**
- Consumes: `Store`, `ItemSchema`, `classifyText`, `extractFields`, `redactSensitive`, `scoreScam`, `planActions`.
- Produces:
  - `createScan(store: Store, input: { imageRefs: string[]; hint: Scan["hint"] }): Promise<Scan>` — persists a scan with `status: "queued"` and no items.
  - `processScan(store: Store, scanId: string, texts: string[]): Promise<Scan>` — loads the scan, classifies/persists items, sets `ready`/`failed`; returns the updated scan.
  - `runScan(store, input)` keeps its current signature and is re-implemented as `createScan` + `processScan` so Plan 1/2 tests stay green.

- [ ] **Step 1: Write the failing tests** — create `test/scans.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../src/storage/fileStore.js";
import { createScan, processScan } from "../src/domain/scans.js";

let store: ReturnType<typeof createFileStore>;
beforeEach(() => { store = createFileStore(mkdtempSync(join(tmpdir(), "wf-"))); });

describe("createScan", () => {
  it("persists a queued scan with no items", async () => {
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    expect(scan.status).toBe("queued");
    expect((await store.listItems("all")).filter((i) => i.scanId === scan.scanId)).toHaveLength(0);
    expect((await store.getScan(scan.scanId))?.status).toBe("queued");
  });
});

describe("processScan", () => {
  it("classifies texts into items and marks the scan ready", async () => {
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    const done = await processScan(store, scan.scanId, ["Amount due: €10. Payment due 2026-10-01."]);
    expect(done.status).toBe("ready");
    const items = (await store.listItems("all")).filter((i) => i.scanId === scan.scanId);
    expect(items).toHaveLength(1);
    expect(items[0]!.class).toBe("bill");
  });

  it("marks the scan failed and persists nothing when a text cannot be processed", async () => {
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    const bad = "x".repeat(1) + "\u0000";
    const real = store;
    const flaky = { ...real, putItem: async () => { throw new Error("disk full"); } } as typeof real;
    const done = await processScan(flaky, scan.scanId, ["Amount due: €10."]);
    expect(done.status).toBe("failed");
    expect((await real.listItems("all")).filter((i) => i.scanId === scan.scanId)).toHaveLength(0);
    void bad;
  });

  it("marks a scan failed when given no text", async () => {
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    const done = await processScan(store, scan.scanId, []);
    expect(done.status).toBe("failed");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/scans.test.ts`
Expected: FAIL — `../src/domain/scans.js` not found.

- [ ] **Step 3: Implement `src/domain/scans.ts`**

```ts
import { randomUUID } from "node:crypto";
import type { Store } from "../storage/types.js";
import type { Item, Scan } from "./model.js";
import { ItemSchema } from "./model.js";
import { classifyText } from "./classifier.js";
import { extractFields } from "./extractors.js";
import { redactSensitive } from "./redact.js";
import { scoreScam } from "./scam.js";
import { planActions } from "./actionPlanner.js";

export async function createScan(store: Store, input: { imageRefs: string[]; hint: Scan["hint"] }): Promise<Scan> {
  const scan: Scan = {
    scanId: `scn_${randomUUID().slice(0, 8)}`,
    hint: input.hint,
    imageRefs: input.imageRefs,
    status: "queued",
    createdAt: new Date().toISOString()
  };
  await store.putScan(scan);
  return scan;
}

export async function processScan(store: Store, scanId: string, texts: string[]): Promise<Scan> {
  const scan = await store.getScan(scanId);
  if (!scan) throw new Error("Unknown scan.");

  const analyzing: Scan = { ...scan, status: "analyzing" };
  await store.putScan(analyzing);

  const items: Item[] = [];
  try {
    for (const text of texts) {
      const signals = {
        hasQrOrLink: /https?:\/\/|\bQR\b/i.test(text),
        hasPaymentRequest: /\b(?:pay|payment|transfer|überweisen)\b/i.test(text),
        senderMismatch: false,
        genericSalutation: /\bdear (?:customer|sir\/madam|account holder)\b/i.test(text)
      };
      const { class: cls, confidence } = classifyText(text, signals);
      const fields = extractFields(text, cls);
      const scam = scoreScam(text, signals);
      const itemId = `itm_${randomUUID().slice(0, 8)}`;
      const createdAt = new Date().toISOString();
      const readAloudText = redactSensitive(text);
      const actions = planActions(
        { itemId, scanId, class: cls, confidence, readAloudText, fields, proposedActions: [], createdAt, resolvedAt: null },
        scam
      );
      items.push(ItemSchema.parse({ itemId, scanId, class: cls, confidence, readAloudText, fields, proposedActions: actions, createdAt, resolvedAt: null }));
    }
  } catch (err) {
    console.error(`[scans] scan ${scanId} failed during analysis:`, err);
    const failed: Scan = { ...analyzing, status: "failed" };
    await store.putScan(failed);
    return failed;
  }

  const written: string[] = [];
  try {
    for (const item of items) {
      written.push(item.itemId);
      await store.putItem(item);
    }
  } catch (err) {
    console.error(`[scans] scan ${scanId} failed while persisting:`, err);
    for (const id of written.reverse()) {
      try { await store.deleteItem(id); } catch (e) { console.error(`[scans] rollback of ${id} failed:`, e); }
    }
    const failed: Scan = { ...analyzing, status: "failed" };
    await store.putScan(failed);
    return failed;
  }

  const done: Scan = { ...analyzing, status: items.length > 0 ? "ready" : "failed" };
  await store.putScan(done);
  return done;
}
```

- [ ] **Step 4: Re-implement `runScan` in `src/domain/scanPipeline.ts`**

Keep `Extractor` and `ScanInput`, replace the body:

```ts
import type { Store } from "../storage/types.js";
import type { Scan } from "./model.js";
import { createScan, processScan } from "./scans.js";

export type Extractor = (imageRefs: string[], hint: Scan["hint"]) => Promise<string[]>;

export interface ScanInput {
  imageRefs: string[];
  hint: Scan["hint"];
  extractedText?: string[];
}

export async function runScan(store: Store, input: ScanInput): Promise<Scan> {
  const scan = await createScan(store, { imageRefs: input.imageRefs, hint: input.hint });
  return processScan(store, scan.scanId, input.extractedText ?? []);
}
```

- [ ] **Step 5: Run the new tests and the full suite**

Run: `npx vitest run test/scans.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: new tests pass; all pre-existing tests (including Plan 1 rollback tests) still pass. If a Plan 1 test asserted the old `analyzing`-first status sequence, reconcile it against the new `queued → analyzing → ready|failed` sequence and note the change.

- [ ] **Step 6: Commit**

```bash
git add src/domain/scans.ts src/domain/scanPipeline.ts test/scans.test.ts
git commit -m "refactor(domain): split scan creation from processing"
```

---

### Task 2: In-process scan worker

**Files:**
- Create: `src/scan/worker.ts`
- Test: `test/worker.test.ts`

**Interfaces:**
- Consumes: `Store`, `Extractor`, `processScan`.
- Produces:

```ts
export interface ScanWorker {
  enqueue(input: { scanId: string; imageRefs: string[]; hint: Scan["hint"] }): void;
  idle(): Promise<void>;
  close(): Promise<void>;
}
export function createScanWorker(deps: {
  store: Store;
  extract?: Extractor;
  onComplete?: (scanId: string) => void;
  concurrency?: number;
}): ScanWorker;
```

`idle()` resolves when the queue is empty and no task is running (used by tests and graceful shutdown).

- [ ] **Step 1: Write the failing tests** — create `test/worker.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../src/storage/fileStore.js";
import { createScan } from "../src/domain/scans.js";
import { createScanWorker } from "../src/scan/worker.js";

let store: ReturnType<typeof createFileStore>;
beforeEach(() => { store = createFileStore(mkdtempSync(join(tmpdir(), "wf-"))); });

describe("scan worker", () => {
  it("processes an enqueued scan and notifies on completion", async () => {
    const completed: string[] = [];
    const worker = createScanWorker({
      store,
      extract: async () => ["Amount due: €10. Payment due 2026-10-01."],
      onComplete: (id) => completed.push(id)
    });
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    worker.enqueue({ scanId: scan.scanId, imageRefs: ["a"], hint: "mail" });
    await worker.idle();
    expect((await store.getScan(scan.scanId))?.status).toBe("ready");
    expect((await store.listItems("all")).filter((i) => i.scanId === scan.scanId)).toHaveLength(1);
    expect(completed).toEqual([scan.scanId]);
    await worker.close();
  });

  it("marks a scan failed when the extractor throws and still notifies", async () => {
    const completed: string[] = [];
    const worker = createScanWorker({
      store,
      extract: async () => { throw new Error("bedrock unavailable"); },
      onComplete: (id) => completed.push(id)
    });
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    worker.enqueue({ scanId: scan.scanId, imageRefs: ["a"], hint: "mail" });
    await worker.idle();
    expect((await store.getScan(scan.scanId))?.status).toBe("failed");
    expect(completed).toEqual([scan.scanId]);
    await worker.close();
  });

  it("marks a scan failed when no extractor is configured", async () => {
    const worker = createScanWorker({ store });
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    worker.enqueue({ scanId: scan.scanId, imageRefs: ["a"], hint: "mail" });
    await worker.idle();
    expect((await store.getScan(scan.scanId))?.status).toBe("failed");
    await worker.close();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/worker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/scan/worker.ts`**

```ts
import type { Store } from "../storage/types.js";
import type { Scan } from "../domain/model.js";
import type { Extractor } from "../domain/scanPipeline.js";
import { processScan } from "../domain/scans.js";

export interface ScanWorker {
  enqueue(input: { scanId: string; imageRefs: string[]; hint: Scan["hint"] }): void;
  idle(): Promise<void>;
  close(): Promise<void>;
}

export function createScanWorker(deps: {
  store: Store;
  extract?: Extractor;
  onComplete?: (scanId: string) => void;
  concurrency?: number;
}): ScanWorker {
  const limit = Math.max(1, deps.concurrency ?? 1);
  const queue: Array<{ scanId: string; imageRefs: string[]; hint: Scan["hint"] }> = [];
  const running = new Set<string>();
  let active = 0;
  let closed = false;
  let drainResolvers: Array<() => void> = [];

  const settleIfIdle = () => {
    if (active === 0 && queue.length === 0) {
      drainResolvers.forEach((r) => r());
      drainResolvers = [];
    }
  };

  const run = async (task: { scanId: string; imageRefs: string[]; hint: Scan["hint"] }) => {
    active += 1;
    running.add(task.scanId);
    try {
      const texts = deps.extract ? await deps.extract(task.imageRefs, task.hint) : [];
      await processScan(deps.store, task.scanId, texts);
    } catch (err) {
      console.error(`[scanWorker] scan ${task.scanId} failed:`, err);
      const scan = await deps.store.getScan(task.scanId).catch(() => null);
      if (scan) await deps.store.putScan({ ...scan, status: "failed" }).catch(() => undefined);
    } finally {
      running.delete(task.scanId);
      active -= 1;
      deps.onComplete?.(task.scanId);
      pump();
      settleIfIdle();
    }
  };

  const pump = () => {
    if (closed) return;
    while (active < limit && queue.length > 0) {
      const next = queue.shift()!;
      void run(next);
    }
  };

  return {
    enqueue(input) {
      if (closed) throw new Error("Worker is closed.");
      queue.push(input);
      pump();
    },
    idle() {
      if (active === 0 && queue.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => { drainResolvers.push(resolve); });
    },
    async close() {
      closed = true;
      await this.idle();
    }
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/worker.test.ts`
Expected: PASS (3 tests). The extractor-throw test logs one `[scanWorker]` line — expected diagnostics.

- [ ] **Step 5: Gates and commit**

Run: `npm test; if ($?) { npm run typecheck }; if ($?) { npm run lint }`

```bash
git add src/scan/worker.ts test/worker.test.ts
git commit -m "feat(scan): add in-process scan worker with drain and failure handling"
```

---

### Task 3: Image source loader

**Files:**
- Create: `src/scan/imageSource.ts`
- Test: `test/imageSource.test.ts`

**Interfaces:**
- Produces:
  - `export interface LoadedImage { bytes: Uint8Array; format: "jpeg" | "png" | "gif" | "webp" }`
  - `export async function loadImage(ref: string): Promise<LoadedImage>` — accepts a `data:` URL or a local file path; throws a clear error otherwise.

- [ ] **Step 1: Write the failing tests** — create `test/imageSource.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadImage } from "../src/scan/imageSource.js";

describe("loadImage", () => {
  it("loads a data URL and infers the format", async () => {
    const png = "iVBORw0KGgo="; // 1x1-ish PNG header bytes, base64
    const img = await loadImage(`data:image/png;base64,${png}`);
    expect(img.format).toBe("png");
    expect(img.bytes.length).toBeGreaterThan(0);
  });

  it("loads a local file and infers the format from the extension", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-"));
    const file = join(dir, "photo.jpg");
    writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    const img = await loadImage(file);
    expect(img.format).toBe("jpeg");
    expect(img.bytes.length).toBe(4);
  });

  it("rejects an unsupported reference", async () => {
    await expect(loadImage("ftp://example.com/x.jpg")).rejects.toThrow();
    await expect(loadImage("no-extension-file")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/imageSource.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/scan/imageSource.ts`**

```ts
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

export interface LoadedImage {
  bytes: Uint8Array;
  format: "jpeg" | "png" | "gif" | "webp";
}

const EXTENSIONS: Record<string, LoadedImage["format"]> = {
  ".jpg": "jpeg", ".jpeg": "jpeg", ".png": "png", ".gif": "gif", ".webp": "webp"
};
const MIME: Record<string, LoadedImage["format"]> = {
  "image/jpeg": "jpeg", "image/png": "png", "image/gif": "gif", "image/webp": "webp"
};

export async function loadImage(ref: string): Promise<LoadedImage> {
  if (ref.startsWith("data:")) {
    const match = ref.match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) throw new Error("Unsupported data URL.");
    const format = MIME[match[1]!.toLowerCase()];
    if (!format) throw new Error(`Unsupported image type: ${match[1]}`);
    return { bytes: new Uint8Array(Buffer.from(match[2]!, "base64")), format };
  }
  const format = EXTENSIONS[extname(ref).toLowerCase()];
  if (!format) throw new Error("Unsupported image reference.");
  return { bytes: new Uint8Array(await readFile(ref)), format };
}
```

- [ ] **Step 4: Run to verify pass, then gates and commit**

Run: `npx vitest run test/imageSource.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`

```bash
git add src/scan/imageSource.ts test/imageSource.test.ts
git commit -m "feat(scan): add image source loader for file paths and data URLs"
```

---

### Task 4: Bedrock multimodal extractor

**Files:**
- Create: `src/scan/bedrockExtractor.ts`
- Modify: `package.json` (add `@aws-sdk/client-bedrock-runtime`)
- Test: `test/bedrockExtractor.test.ts`

**Interfaces:**
- Consumes: `Extractor`, `loadImage`.
- Produces:

```ts
export interface BedrockConverseLike {
  send(command: unknown): Promise<unknown>;
}
export function createBedrockExtractor(deps: {
  client: BedrockConverseLike;
  modelId: string;
  maxTokens?: number;
}): Extractor;
```

The extractor loads each image, sends one Converse request per image asking for the readable text verbatim, and concatenates the returned text blocks. It must throw on failure (the worker marks the scan failed) rather than silently returning `[]`.

- [ ] **Step 1: Add the dependency**

Run: `npm install @aws-sdk/client-bedrock-runtime`
Expected: installs; `package.json` gains the dependency.

- [ ] **Step 2: Write the failing tests** — create `test/bedrockExtractor.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { createBedrockExtractor } from "../src/scan/bedrockExtractor.js";

const png = "iVBORw0KGgo=";

function fakeClient(response: unknown, capture: { commands: unknown[] }) {
  return { async send(command: unknown) { capture.commands.push(command); return response; } };
}

describe("createBedrockExtractor", () => {
  it("sends one image block per image and concatenates text output", async () => {
    const capture = { commands: [] as unknown[] };
    let call = 0;
    const client = {
      async send(command: unknown) {
        capture.commands.push(command);
        call += 1;
        return { output: { message: { content: [{ text: call === 1 ? "Amount due: €10." : "Payment due 2026-10-01." }] } } };
      }
    };
    const extract = createBedrockExtractor({ client, modelId: "test-model" });
    const texts = await extract([`data:image/png;base64,${png}`, `data:image/png;base64,${png}`], "mail");
    expect(texts).toEqual(["Amount due: €10.", "Payment due 2026-10-01."]);
    expect(capture.commands).toHaveLength(2);
    expect(JSON.stringify(capture.commands)).toContain("test-model");
  });

  it("throws when the client fails", async () => {
    const client = { async send() { throw new Error("access denied"); } };
    const extract = createBedrockExtractor({ client, modelId: "test-model" });
    await expect(extract([`data:image/png;base64,${png}`], "mail")).rejects.toThrow();
  });

  it("returns an empty text entry when the model returns no text", async () => {
    const client = fakeClient({ output: { message: { content: [] } } }, { commands: [] });
    const extract = createBedrockExtractor({ client, modelId: "test-model" });
    expect(await extract([`data:image/png;base64,${png}`], "mail")).toEqual([""]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/bedrockExtractor.test.ts`
Expected: FAIL — module not found (after the dependency installs).

- [ ] **Step 4: Implement `src/scan/bedrockExtractor.ts`**

```ts
import type { Extractor } from "../domain/scanPipeline.js";
import { loadImage } from "./imageSource.js";

export interface BedrockConverseLike {
  send(command: unknown): Promise<unknown>;
}

const PROMPT =
  "Read every piece of text visible in this image and return it verbatim, " +
  "preserving line breaks. Do not summarise, translate, or add commentary. " +
  "If there is no text, return an empty string.";

interface ConverseResponse {
  output?: { message?: { content?: Array<{ text?: string }> } };
}

export function createBedrockExtractor(deps: {
  client: BedrockConverseLike;
  modelId: string;
  maxTokens?: number;
}): Extractor {
  return async (imageRefs) => {
    const texts: string[] = [];
    for (const ref of imageRefs) {
      const image = await loadImage(ref);
      const response = (await deps.client.send({
        modelId: deps.modelId,
        messages: [
          {
            role: "user",
            content: [
              { image: { format: image.format, source: { bytes: image.bytes } } },
              { text: PROMPT }
            ]
          }
        ],
        inferenceConfig: { maxTokens: deps.maxTokens ?? 1024 }
      })) as ConverseResponse;
      const blocks = response.output?.message?.content ?? [];
      texts.push(blocks.map((b) => b.text ?? "").join("\n").trim());
    }
    return texts;
  };
}
```

- [ ] **Step 5: Run to verify pass, then gates and commit**

Run: `npx vitest run test/bedrockExtractor.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`

```bash
git add package.json package-lock.json src/scan/bedrockExtractor.ts test/bedrockExtractor.test.ts
git commit -m "feat(scan): add Bedrock multimodal extractor behind the Extractor seam"
```

---

### Task 5: MCP executor and Bedrock agent brain

**Files:**
- Create: `src/agent/mcpExecutor.ts`, `src/agent/bedrockBrain.ts`
- Test: `test/mcpExecutor.test.ts`, `test/bedrockBrain.test.ts`

**Interfaces:**
- Produces:

```ts
// mcpExecutor.ts
export interface ToolSpec { name: string; description: string; inputSchema: Record<string, unknown> }
export interface McpExecutor {
  listTools(): Promise<ToolSpec[]>;
  callTool(name: string, input: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  close(): Promise<void>;
}
export function createMcpExecutor(deps: { client: McpClientLike }): McpExecutor;

// bedrockBrain.ts
export interface AgentResult { reply: string; toolCalls: Array<{ name: string; input: Record<string, unknown> }> }
export function createBedrockBrain(deps: {
  client: BedrockConverseLike;
  executor: McpExecutor;
  modelId: string;
  maxRounds?: number;
  systemPrompt?: string;
}): { respond(utterance: string, history: Array<{ role: "user" | "assistant"; text: string }>): Promise<AgentResult> };
```

The brain appends the utterance, calls Converse with the executor's tool specs, executes any `toolUse` blocks through the executor, feeds `toolResult` blocks back, and repeats until the model answers in text or `maxRounds` is hit (default 4).

- [ ] **Step 1: Write the failing executor tests** — create `test/mcpExecutor.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { createMcpExecutor } from "../src/agent/mcpExecutor.js";

describe("createMcpExecutor", () => {
  it("converts MCP tool descriptors into Bedrock-compatible specs", async () => {
    const client = {
      async listTools() {
        return { tools: [{ name: "daily_briefing", description: "brief", inputSchema: { type: "object", properties: {}, $schema: "x" } }] };
      },
      async callTool() { return { content: [{ type: "text", text: "ok" }] }; },
      async close() {}
    };
    const exec = createMcpExecutor({ client });
    const specs = await exec.listTools();
    expect(specs).toHaveLength(1);
    expect(specs[0]!.name).toBe("daily_briefing");
    expect((specs[0]!.inputSchema as Record<string, unknown>).$schema).toBeUndefined();
  });

  it("flattens text content and reports errors", async () => {
    const client = {
      async listTools() { return { tools: [] }; },
      async callTool() { return { isError: true, content: [{ type: "text", text: "nope" }] }; },
      async close() {}
    };
    const exec = createMcpExecutor({ client });
    expect(await exec.callTool("x", {})).toEqual({ text: "nope", isError: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/mcpExecutor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/agent/mcpExecutor.ts`**

```ts
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpClientLike {
  listTools(): Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> }>;
  callTool(request: { name: string; arguments: Record<string, unknown> }): Promise<{ isError?: boolean; content?: unknown }>;
  close(): Promise<void>;
}

export interface McpExecutor {
  listTools(): Promise<ToolSpec[]>;
  callTool(name: string, input: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  close(): Promise<void>;
}

function contentToText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block === "object" && block !== null && "text" in block) {
        const text = (block as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function createMcpExecutor(deps: { client: McpClientLike }): McpExecutor {
  return {
    async listTools() {
      const { tools } = await deps.client.listTools();
      return tools.map((tool) => {
        const schema = { ...(tool.inputSchema ?? { type: "object", properties: {} }) };
        delete schema["$schema"];
        return { name: tool.name, description: tool.description ?? tool.name, inputSchema: schema };
      });
    },
    async callTool(name, input) {
      const result = await deps.client.callTool({ name, arguments: input });
      return { text: contentToText(result.content), isError: result.isError === true };
    },
    async close() { await deps.client.close(); }
  };
}
```

- [ ] **Step 4: Write the failing brain tests** — create `test/bedrockBrain.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { createBedrockBrain } from "../src/agent/bedrockBrain.js";
import type { McpExecutor } from "../src/agent/mcpExecutor.js";

const executor: McpExecutor = {
  async listTools() {
    return [{ name: "daily_briefing", description: "brief", inputSchema: { type: "object", properties: {} } }];
  },
  async callTool() { return { text: "You have 1 due, 0 flagged.", isError: false }; },
  async close() {}
};

describe("createBedrockBrain", () => {
  it("executes a tool use round and returns the final text", async () => {
    const sent: unknown[] = [];
    let call = 0;
    const client = {
      async send(command: unknown) {
        sent.push(command);
        call += 1;
        if (call === 1) {
          return { output: { message: { role: "assistant", content: [{ toolUse: { toolUseId: "t1", name: "daily_briefing", input: {} } }] } } };
        }
        return { output: { message: { role: "assistant", content: [{ text: "You have 1 due item." }] } } };
      }
    };
    const brain = createBedrockBrain({ client, executor, modelId: "test-model" });
    const result = await brain.respond("what's due?", []);
    expect(result.reply).toBe("You have 1 due item.");
    expect(result.toolCalls).toEqual([{ name: "daily_briefing", input: {} }]);
    expect(sent).toHaveLength(2);
  });

  it("returns a safe message when the model never produces text", async () => {
    const client = { async send() { return { output: { message: { role: "assistant", content: [] } } }; } };
    const brain = createBedrockBrain({ client, executor, modelId: "test-model", maxRounds: 2 });
    const result = await brain.respond("hello", []);
    expect(result.reply.length).toBeGreaterThan(0);
    expect(result.toolCalls).toEqual([]);
  });
});
```

- [ ] **Step 5: Implement `src/agent/bedrockBrain.ts`**

```ts
import type { AgentResult, Brain } from "./types.js";
import type { McpExecutor } from "./mcpExecutor.js";
import type { BedrockConverseLike } from "../scan/bedrockExtractor.js";
```
Import `AgentResult`/`Brain` from a new `src/agent/types.ts`:

```ts
// src/agent/types.ts
export interface AgentResult {
  reply: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
}
export interface HistoryEntry { role: "user" | "assistant"; text: string }
export interface Brain {
  respond(utterance: string, history: HistoryEntry[]): Promise<AgentResult>;
}
```

```ts
// src/agent/bedrockBrain.ts
import type { BedrockConverseLike } from "../scan/bedrockExtractor.js";
import type { McpExecutor } from "./mcpExecutor.js";
import type { AgentResult, Brain, HistoryEntry } from "./types.js";

const DEFAULT_SYSTEM =
  "You are Wayfinder, a voice-first assistant for blind and low-vision people. " +
  "Use the available tools to complete the user's request rather than describing what you would do. " +
  "Never read out identifiers, URLs, JSON, or internal tool names. " +
  "For labels and medication, read the text verbatim and never give medical advice. " +
  "This is a simulation of a voice assistant; keep replies short and spoken-friendly.";

interface ConverseContent {
  text?: string;
  toolUse?: { toolUseId: string; name: string; input?: Record<string, unknown> };
}
interface ConverseResponse {
  output?: { message?: { role?: string; content?: ConverseContent[] } };
}

export function createBedrockBrain(deps: {
  client: BedrockConverseLike;
  executor: McpExecutor;
  modelId: string;
  maxRounds?: number;
  systemPrompt?: string;
}): Brain {
  const maxRounds = Math.max(1, deps.maxRounds ?? 4);

  return {
    async respond(utterance, history): Promise<AgentResult> {
      const toolSpecs = await deps.executor.listTools();
      const tools = toolSpecs.map((t) => ({
        toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.inputSchema } }
      }));

      const messages: Array<{ role: "user" | "assistant"; content: unknown }> = history.map((h) => ({
        role: h.role,
        content: [{ text: h.text }]
      }));
      messages.push({ role: "user", content: [{ text: utterance }] });

      const toolCalls: AgentResult["toolCalls"] = [];

      for (let round = 0; round < maxRounds; round += 1) {
        const response = (await deps.client.send({
          modelId: deps.modelId,
          system: [{ text: deps.systemPrompt ?? DEFAULT_SYSTEM }],
          messages,
          toolConfig: { tools }
        })) as ConverseResponse;

        const content = response.output?.message?.content ?? [];
        const toolUses = content.filter((c) => c.toolUse);
        const text = content.map((c) => c.text ?? "").join(" ").trim();

        if (toolUses.length === 0) {
          return { reply: text || "I'm not sure how to help with that yet.", toolCalls };
        }

        messages.push({ role: "assistant", content });
        const results: Array<{ toolResult: { toolUseId: string; content: Array<{ json: unknown }>; status: string } }> = [];
        for (const block of toolUses) {
          const use = block.toolUse!;
          const input = use.input ?? {};
          toolCalls.push({ name: use.name, input });
          const outcome = await deps.executor.callTool(use.name, input);
          results.push({
            toolResult: {
              toolUseId: use.toolUseId,
              content: [{ json: { text: outcome.text, isError: outcome.isError } }],
              status: outcome.isError ? "error" : "success"
            }
          });
        }
        messages.push({ role: "user", content: results });
      }

      return { reply: "I couldn't finish that — please try again.", toolCalls };
    }
  };
}
```

- [ ] **Step 6: Run to verify pass, then gates and commit**

Run: `npx vitest run test/mcpExecutor.test.ts; if ($?) { npx vitest run test/bedrockBrain.test.ts }; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`

```bash
git add src/agent/mcpExecutor.ts src/agent/bedrockBrain.ts src/agent/types.ts test/mcpExecutor.test.ts test/bedrockBrain.test.ts
git commit -m "feat(agent): add MCP executor and Bedrock tool-use brain"
```

---

### Task 6: Rule brain, brain selection, async `capture_scan`, `/api/agent`

**Files:**
- Create: `src/agent/ruleBrain.ts`, `src/agent/service.ts`
- Modify: `src/mcp/server.ts`, `src/server/http.ts`, `src/server/index.ts`, `src/domain/copy.ts`
- Test: `test/ruleBrain.test.ts`, `test/agentService.test.ts`, `test/asyncScan.test.ts`

**Interfaces:**
- `createRuleBrain(deps: { executor: McpExecutor; demoImageRef?: string }): Brain` — deterministic intents:
  - `/read|scan|look at/i` + `mail|post|letter` → `capture_scan` (hint `mail`)
  - `/label|ingredient|expiry|use by/i` → `identify_product`
  - `/what.*(due|owe)|briefing|today/i` → `daily_briefing`
  - `/where (is|are) my (.+)/i` → `find_object` with `{ name: match }`
  - `/remember (?:my )?(.+) (?:is|are) (?:on|in|at) (.+)/i` → `remember_object`
  - fallback → `daily_briefing`
- `createAgentService(deps): { handle(utterance, history?): Promise<{ reply, brain, toolCalls }>; brainName: string }` — uses Bedrock when a client+executor are supplied, otherwise the rule brain.
- `capture_scan` becomes: no extractor → `readerUnavailable` (unchanged); else `createScan` + `worker.enqueue` → `{ scanId, status: "queued" }` + `copy.scanStarted`.
- `get_scan` returns `{ status, items }` and speaks an interim line when not ready.
- `createHttpApp` gains `worker`, `agent`, and `POST /api/agent`.

- [ ] **Step 1: Write the failing rule-brain tests** — create `test/ruleBrain.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { createRuleBrain } from "../src/agent/ruleBrain.js";
import type { McpExecutor } from "../src/agent/mcpExecutor.js";

function executor(): { calls: Array<{ name: string; input: Record<string, unknown> }>; exec: McpExecutor } {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  return {
    calls,
    exec: {
      async listTools() { return [{ name: "capture_scan", description: "scan", inputSchema: {} }]; },
      async callTool(name, input) { calls.push({ name, input }); return { text: "done", isError: false }; },
      async close() {}
    }
  };
}

describe("createRuleBrain", () => {
  it("routes mail reading to capture_scan", async () => {
    const { calls, exec } = executor();
    const brain = createRuleBrain({ executor: exec });
    const r = await brain.respond("read my mail", []);
    expect(calls[0]!.name).toBe("capture_scan");
    expect(r.reply).toBe("done");
  });

  it("routes 'where are my keys' to find_object with the name", async () => {
    const { calls, exec } = executor();
    const brain = createRuleBrain({ executor: exec });
    await brain.respond("where are my keys?", []);
    expect(calls[0]).toEqual({ name: "find_object", input: { name: "keys" } });
  });

  it("falls back to daily_briefing for anything else", async () => {
    const { calls, exec } = executor();
    const brain = createRuleBrain({ executor: exec });
    await brain.respond("blah", []);
    expect(calls[0]!.name).toBe("daily_briefing");
  });
});
```

- [ ] **Step 2: Implement `src/agent/ruleBrain.ts`**

```ts
import type { McpExecutor } from "./mcpExecutor.js";
import type { AgentResult, Brain } from "./types.js";

interface Intent {
  pattern: RegExp;
  name: string;
  input: (m: RegExpMatchArray) => Record<string, unknown>;
}

const FALLBACK = "daily_briefing";

export function createRuleBrain(deps: { executor: McpExecutor; demoImageRef?: string }): Brain {
  const demoImageRef = deps.demoImageRef ?? "demo";
  const intents: Intent[] = [
    { pattern: /read|scan|look at/i, name: "capture_scan", input: () => ({ imageRefs: [demoImageRef], hint: "mail" }) },
    { pattern: /label|ingredient|expiry|use by/i, name: "identify_product", input: () => ({ imageRefs: [demoImageRef] }) },
    { pattern: /where (?:is|are) my (.+)/i, name: "find_object", input: (m) => ({ name: (m[1] ?? "").replace(/[?.!]/g, "").trim() }) },
    { pattern: /remember (?:my )?(.+?) (?:is|are) (?:on|in|at) (.+)/i, name: "remember_object",
      input: (m) => ({ name: (m[1] ?? "").trim(), locationNote: (m[2] ?? "").replace(/[.]/g, "").trim() }) },
    { pattern: /briefing|what.*(?:due|owe)|today/i, name: "daily_briefing", input: () => ({}) }
  ];

  return {
    async respond(utterance): Promise<AgentResult> {
      const intent = intents.find((i) => i.pattern.test(utterance));
      const name = intent?.name ?? FALLBACK;
      const match = intent?.pattern.exec(utterance) ?? ([""] as unknown as RegExpMatchArray);
      const input = intent ? intent.input(match) : {};
      const outcome = await deps.executor.callTool(name, input);
      return { reply: outcome.text || "Done.", toolCalls: [{ name, input }] };
    }
  };
}
```

The rule brain's `capture_scan`/`identify_product` need an image reference; `demoImageRef` is injected so tests and the demo can point at a real fixture without the brain knowing about the filesystem.

- [ ] **Step 3: Write the failing service tests** — create `test/agentService.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { createAgentService } from "../src/agent/service.js";
import type { McpExecutor } from "../src/agent/mcpExecutor.js";

const exec: McpExecutor = {
  async listTools() { return [{ name: "daily_briefing", description: "b", inputSchema: {} }]; },
  async callTool() { return { text: "Nothing needs your attention today.", isError: false }; },
  async close() {}
};

describe("createAgentService", () => {
  it("uses the rule brain when no Bedrock client is configured", async () => {
    const service = createAgentService({ executor: exec });
    const result = await service.handle("what's due today?");
    expect(result.brain).toBe("rules");
    expect(result.reply).toContain("Nothing");
  });

  it("reports the active brain name", () => {
    expect(createAgentService({ executor: exec }).brainName).toBe("rules");
  });
});
```

- [ ] **Step 4: Implement `src/agent/service.ts`**

```ts
import type { BedrockConverseLike } from "../scan/bedrockExtractor.js";
import type { McpExecutor } from "./mcpExecutor.js";
import { createBedrockBrain } from "./bedrockBrain.js";
import { createRuleBrain } from "./ruleBrain.js";
import type { AgentResult, Brain, HistoryEntry } from "./types.js";

export interface AgentService {
  brainName: "bedrock" | "rules";
  handle(utterance: string, history?: HistoryEntry[]): Promise<AgentResult & { brain: "bedrock" | "rules" }>;
}

export function createAgentService(deps: {
  executor: McpExecutor;
  client?: BedrockConverseLike;
  modelId?: string;
}): AgentService {
  const useBedrock = Boolean(deps.client && deps.modelId);
  const brain: Brain = useBedrock
    ? createBedrockBrain({ client: deps.client!, executor: deps.executor, modelId: deps.modelId! })
    : createRuleBrain({ executor: deps.executor });
  const brainName = useBedrock ? "bedrock" : "rules";

  return {
    brainName,
    async handle(utterance, history = []) {
      const result = await brain.respond(utterance, history);
      return { ...result, brain: brainName };
    }
  };
}
```

- [ ] **Step 5: Make `capture_scan` async and add worker/push wiring to `src/mcp/server.ts`**

Change `buildServer` deps to include a worker and a notifier:

```ts
export interface ServerDeps {
  store: Store;
  extract?: Extractor;
  worker?: ScanWorker;
}
export function buildServer(deps: ServerDeps): McpServer
```

`capture_scan`:

```ts
      if (!deps.extract || !deps.worker) {
        return {
          content: [{ type: "text", text: copy.readerUnavailable }],
          structuredContent: { available: false, count: 0 }
        };
      }
      const scan = await createScan(deps.store, { imageRefs, hint });
      deps.worker.enqueue({ scanId: scan.scanId, imageRefs, hint });
      return {
        content: [{ type: "text", text: copy.scanStarted }],
        structuredContent: { scanId: scan.scanId, status: "queued", available: true }
      };
```

`get_scan`:

```ts
      const scan = await deps.store.getScan(scanId);
      const items = (await deps.store.listItems("all")).filter((i) => i.scanId === scanId);
      if (!scan) return { content: [{ type: "text", text: copy.nothingFound }], isError: true };
      if (scan.status === "queued" || scan.status === "analyzing") {
        return { content: [{ type: "text", text: copy.scanStarted }], structuredContent: { scanId, status: scan.status, items: [] } };
      }
      if (scan.status === "failed") {
        return { content: [{ type: "text", text: copy.scanFailed }], structuredContent: { scanId, status: "failed", items: [] } };
      }
      const spoken = items.map((i) => (i.class === "label" ? `${i.readAloudText} ${copy.disclaimers.label}` : i.readAloudText)).join(" ");
      return { content: [{ type: "text", text: spoken || copy.nothingFound }], structuredContent: { scanId, status: scan.status, items } };
```

Add to `copy`: `scanQueued: "I'm reading that now — I'll tell you when it's ready."` (use it for the queued interim).

- [ ] **Step 6: Wire worker, push, and `/api/agent` in `src/server/http.ts`**

- Register each session's `McpServer` alongside its transport so the worker can push:

```ts
const sessions = new Map<string, { transport: StreamableHTTPServerTransport; notify: (message: string) => void }>();
```

When creating a server for a session, build a `notify` closure that sends a `notifications/message`:

```ts
const server = buildServer(deps);
const notify = (message: string) => {
  void server.server.notification({ method: "notifications/message", params: { level: "info", data: message } }).catch(() => undefined);
};
```

(Verify `McpServer.server.notification(...)` exists in SDK v1.30; if not, send the JSON-RPC notification over the transport's SSE stream, or record the intent and assert it in tests.)

- `POST /api/agent`:

```ts
app.post("/api/agent", async (req, res) => {
  const utterance = typeof req.body?.utterance === "string" ? req.body.utterance : "";
  if (!utterance.trim()) { res.status(400).json({ error: "utterance required" }); return; }
  if (!deps.agent) { res.status(503).json({ error: "agent unavailable" }); return; }
  const result = await deps.agent.handle(utterance);
  res.json(result);
});
```

- `createHttpApp` deps become `{ store; extract?; allowedOrigins?; worker?; agent? }`.

- [ ] **Step 7: Write the failing async-scan tests** — create `test/asyncScan.test.ts`

Drive `buildServer` over `InMemoryTransport` with a stub extractor and a real worker, asserting `capture_scan` returns immediately with `status: "queued"`, then after `worker.idle()` `get_scan` returns `ready` with items. Also assert that with no extractor the reader-unavailable path still returns `available: false`.

- [ ] **Step 8: Construct everything in `src/server/index.ts`**

```ts
const extract = process.env.BEDROCK_MODEL_ID
  ? createBedrockExtractor({ client: new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "eu-central-1" }), modelId: process.env.BEDROCK_MODEL_ID })
  : undefined;
const store = createFileStore(dir);
const worker = createScanWorker({ store, extract, onComplete: (id) => console.log(`[wayfinder] scan ${id} complete`) });
console.log(`[wayfinder] extractor: ${extract ? "bedrock" : "none (reader unavailable)"}`);
```

Wire the agent executor to the local MCP URL and pass `worker`/`agent` into `createHttpApp`.

- [ ] **Step 9: Gates and commit**

Run: `npm test; if ($?) { npm run typecheck }; if ($?) { npm run lint }; if ($?) { npm run build }`

```bash
git add src/agent src/mcp/server.ts src/server/http.ts src/server/index.ts src/domain/copy.ts test/ruleBrain.test.ts test/agentService.test.ts test/asyncScan.test.ts
git commit -m "feat(agent): rule brain, brain selection, async capture_scan, and /api/agent"
```

---

## Self-Review

**Spec coverage (Plan 3 scope):** async scan job with interim reply and `get_scan` status (§8.1, §10.1); server-push on completion (§8.1); Bedrock multimodal extraction behind the injected `Extractor` (§7.2, §9.2); Bedrock brain over a real MCP client with rule fallback (§13); `/api/agent` consumes utterances (§14). Remaining: simulated client + MCP Apps UI (§12, §14) → Plan 4; classic Skill, OAuth, AWS, conformance (§11, §14, §15) → Plan 5; docs/video (§19–§20) → Plan 6.

**Placeholder scan:** none — every step carries real code.

**Type consistency:** `Extractor`, `ScanWorker`, `McpExecutor`, `BedrockConverseLike`, `Brain`, `AgentResult` are defined once and imported by later tasks. `buildServer` deps grow to `{ store, extract?, worker? }` and `createHttpApp` to `{ store, extract?, allowedOrigins?, worker?, agent? }`; both are additive and keep earlier call sites compiling.

**Ordering:** Task 1 (create/process split) precedes Task 2 (worker uses `processScan`). Task 3 (`loadImage`) precedes Task 4 (extractor uses it). Task 5 (executor/brain) is independent of 1–4 and precedes Task 6 (service wires them). Task 6 wires the worker from Task 2 and the async `capture_scan`.

**Risk note:** `McpServer.server.notification(...)` availability in SDK v1.30 is the one unverified API in this plan; Step 6 says to verify it and gives a fallback. Bedrock model IDs drift — the plan reads `BEDROCK_MODEL_ID` from the environment and never asserts on a literal.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-09-19-wayfinder-async-agent.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — execute in this session with checkpoints.

Which approach?
