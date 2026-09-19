# Wayfinder — Plan 2: MCP Surface, Action Persistence & Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Wayfinder MCP surface (the remaining six tools plus resources and a prompt), make actions first-class in storage, and clear the Plan 1 carry-overs and Copilot review findings — all server-side and independently testable.

**Architecture:** Builds directly on Plan 1. Domain logic stays pure (`applyAction`, `parseLabel`, `redactSensitive`); the store gains action and delete operations behind the existing `Store` interface; the MCP server registers the new tools, resources, and prompt; the HTTP layer gains spec-mandated `Origin` validation and a loopback default bind. No UI and no Bedrock — the extractor seam from Plan 1 is the integration point for Plan 3.

**Tech Stack:** Node 22+ ESM, TypeScript 5, `@modelcontextprotocol/sdk`, `zod`, `express`, `vitest`, `eslint`, `prettier`.

**Spec:** `docs/superpowers/specs/2026-09-19-wayfinder-design.md`

## Global Constraints

- Node **22+**; ESM (`"type": "module"`).
- MCP spec **`2025-11-25`**, **Streamable HTTP**, sessionful (`MCP-Session-Id`).
- Tool handlers return in **< 500 ms** — no network or model calls inside handlers.
- Domain core is **pure**: no I/O, no AWS, no model calls.
- Customer-facing text must contain **no IDs, URLs, JSON, or tool names**.
- **No medical/financial advice**: label text read verbatim + `copy.disclaimers.label`; account numbers masked (`••••1234`), never recited in full.
- **Origin validation is mandatory** (MCP security requirement): invalid `Origin` → HTTP **403**.
- Local default bind is **loopback** (`127.0.0.1`), overridable by `HOST`.
- All user-facing strings live in `src/domain/copy.ts`.
- Commits use the message given in each task.

## Copilot review findings incorporated

| Finding | Task |
|---|---|
| Grouped IBANs not masked | T1 |
| No default extractor → silent scan failure | T4 |
| Missing `Origin` validation | T5 |
| Unauthenticated public bind | T5 |
| `senderMismatch` from generic salutation | T3 |
| Non-atomic scan persistence | T3 |
| Unused label disclaimer | T7 |

---

## File Structure

```
src/domain/redact.ts          MODIFY grouped-format masking
src/domain/classifier.ts      MODIFY Signals + scam scoring (genericSalutation; honest mismatch)
src/domain/scanPipeline.ts    MODIFY honest signals + atomic persistence with rollback
src/domain/applyAction.ts     CREATE pure action application over the store
src/domain/labelParser.ts     CREATE verbatim label parsing
src/domain/copy.ts            MODIFY add readerUnavailable + action strings
src/storage/types.ts          MODIFY add deleteItem
src/storage/fileStore.ts      MODIFY actions persistence, deleteItem, resilient reads, filters
src/mcp/server.ts             MODIFY add 6 tools; extractor-unavailable signaling; label disclaimer
src/server/http.ts            MODIFY Origin allowlist validation
src/server/index.ts           MODIFY loopback default bind + extractor wiring/logging
test/redact.test.ts           MODIFY grouped cases
test/classifier.test.ts       MODIFY generic-salutation cases
test/scanPipeline.test.ts     MODIFY rollback case
test/fileStore.test.ts        MODIFY actions/delete/filters/corrupt-file cases
test/applyAction.test.ts      CREATE
test/labelParser.test.ts      CREATE
test/tools.test.ts            CREATE new-tool coverage
test/origin.test.ts           CREATE
```

---

### Task 1: Redaction hardening for grouped account formats

Fixes Copilot finding #1. OCR commonly returns IBANs in printed groups (`DE89 3704 0044 0532 0130 00`) and cards as `4111 1111 1111 1111`; the current matchers require contiguous tokens, so these reach `readAloudText` unmasked.

**Files:**
- Modify: `src/domain/redact.ts`
- Test: `test/redact.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `redactSensitive(text: string): string` (unchanged signature); `maskAccount(raw: string): string` (unchanged).

- [ ] **Step 1: Write the failing tests** — append to `test/redact.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { redactSensitive, maskAccount } from "../src/domain/redact.js";

describe("redactSensitive grouped formats", () => {
  it("masks a space-grouped IBAN", () => {
    expect(redactSensitive("IBAN DE89 3704 0044 0532 0130 00")).toBe("IBAN ••••3000");
  });
  it("masks a space-grouped card number", () => {
    expect(redactSensitive("card 4111 1111 1111 1111")).toBe("card ••••1111");
  });
  it("masks a dash-grouped account number", () => {
    expect(redactSensitive("acct 1234-5678-9012")).toBe("acct ••••9012");
  });
  it("still masks contiguous IBAN and long digit runs", () => {
    expect(redactSensitive("DE89370400440532013000")).toBe("••••3000");
    expect(redactSensitive("ref 1234567890")).toBe("ref ••••7890");
  });
  it("leaves ordinary dates and amounts untouched", () => {
    expect(redactSensitive("due 2026-10-01 total €84.20")).toBe("due 2026-10-01 total €84.20");
    expect(redactSensitive("appointment 2026 10 12")).toBe("appointment 2026 10 12");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/redact.test.ts`
Expected: FAIL — grouped IBAN/card/dash cases return unmasked text.

- [ ] **Step 3: Implement** — full new body of `src/domain/redact.ts`

```ts
const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/gi;
const LONG_DIGITS = /\b\d{7,}\b/g;
// Printed IBANs: "DE89 3704 0044 0532 0130 00" — country code + digit groups.
const GROUPED_IBAN = /\b[A-Z]{2}\d{2}(?:[ -]?\d{4}){2,7}(?:[ -]?\d{1,4})?\b/gi;
// Grouped card/account numbers: two or more 4-digit groups, space or dash separated.
const GROUPED_DIGITS = /\b\d{4}(?:[ -]\d{4}){1,}\b/g;

export function maskAccount(raw: string): string {
  const clean = raw.replace(/\s+/g, "");
  if (clean.length < 5) {
    return clean.length > 2 ? `••••${clean.slice(-2)}` : "••••";
  }
  return `••••${clean.slice(-4)}`;
}

export function redactSensitive(text: string): string {
  return text
    .replace(IBAN, (m) => maskAccount(m))
    .replace(GROUPED_IBAN, (m) => maskAccount(m))
    .replace(LONG_DIGITS, (m) => maskAccount(m))
    .replace(GROUPED_DIGITS, (m) => maskAccount(m));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/redact.test.ts`
Expected: PASS (all cases). Note: `GROUPED_DIGITS` requires 4-digit groups so `2026 10 12` is not masked; a `"2026 1000"` style would be — acceptable, privacy-safe.

- [ ] **Step 5: Full suite, typecheck, lint, commit**

Run: `npm test; if ($?) { npm run typecheck }; if ($?) { npm run lint }`

```bash
git add src/domain/redact.ts test/redact.test.ts
git commit -m "fix(domain): mask grouped IBAN and account-number formats"
```

---

### Task 2: Store actions, delete, resilient reads, and correct filters

Fixes the Plan 1 stubs behind Copilot findings #6 (rollback needs delete) and #7 (flagged filter must reflect real flag actions).

**Files:**
- Modify: `src/storage/types.ts`, `src/storage/fileStore.ts`
- Test: `test/fileStore.test.ts`

**Interfaces:**
- Produces: `Store.deleteItem(id: string): Promise<void>` (new interface method); real `putAction`/`listActions` persistence keyed by `itemId`; `listItems("flagged")` includes items with a `flag` action that is `done`/`confirmed`; `listItems("due")` excludes resolved items; corrupt files are skipped rather than aborting a listing.

- [ ] **Step 1: Write the failing tests** — append to `test/fileStore.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../src/storage/fileStore.js";
import type { Item, Action } from "../src/domain/model.js";

const mkItem = (over: Partial<Item> = {}): Item => ({
  itemId: "itm_a", scanId: "scn_a", class: "personal", confidence: 0.5,
  readAloudText: "hello", fields: {}, proposedActions: [],
  createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null, ...over
});
const mkAction = (over: Partial<Action> = {}): Action => ({
  actionId: "itm_a:flag", itemId: "itm_a", type: "flag", params: {}, status: "done", ...over
});

let dir: string;
let store: ReturnType<typeof createFileStore>;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "wf-")); store = createFileStore(dir); });

describe("actions persistence", () => {
  it("round-trips actions per item and upserts by actionId", async () => {
    await store.putAction(mkAction());
    await store.putAction(mkAction({ status: "confirmed" }));
    const list = await store.listActions("itm_a");
    expect(list).toHaveLength(1);
    expect(list[0]!.status).toBe("confirmed");
  });
});

describe("deleteItem", () => {
  it("removes an item and rejects unsafe ids", async () => {
    await store.putItem(mkItem());
    await store.deleteItem("itm_a");
    expect(await store.getItem("itm_a")).toBeNull();
    await expect(store.deleteItem("../../etc/passwd")).rejects.toThrow();
  });
});

describe("listItems filters", () => {
  it("flags scam items and items with a done flag action", async () => {
    await store.putItem(mkItem({ itemId: "itm_x", class: "scam" }));
    await store.putItem(mkItem({ itemId: "itm_b" }));
    await store.putAction(mkAction({ actionId: "itm_b:flag", itemId: "itm_b", status: "done" }));
    const flagged = await store.listItems("flagged");
    expect(flagged.map((i) => i.itemId).sort()).toEqual(["itm_b", "itm_x"]);
  });
  it("excludes resolved items from due", async () => {
    await store.putItem(mkItem({ itemId: "itm_d", fields: { dueDate: "2020-01-01" } }));
    await store.putItem(mkItem({ itemId: "itm_r", fields: { dueDate: "2020-01-01" }, resolvedAt: "2020-01-02T00:00:00.000Z" }));
    const due = await store.listItems("due");
    expect(due.map((i) => i.itemId)).toEqual(["itm_d"]);
  });
});

describe("resilience", () => {
  it("skips a corrupt item file instead of aborting the listing", async () => {
    await store.putItem(mkItem({ itemId: "itm_ok" }));
    mkdirSync(join(dir, "items"), { recursive: true });
    writeFileSync(join(dir, "items", "itm_bad.json"), "{not json", "utf8");
    const all = await store.listItems("all");
    expect(all.map((i) => i.itemId)).toContain("itm_ok");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/fileStore.test.ts`
Expected: FAIL — `deleteItem` missing; `flagged`/`due`/corrupt-file cases fail.

- [ ] **Step 3: Implement** — `src/storage/types.ts`

```ts
import type { Scan, Item, Action, StoredObject, Preferences } from "../domain/model.js";

export interface Store {
  putScan(s: Scan): Promise<void>;
  getScan(id: string): Promise<Scan | null>;
  putItem(i: Item): Promise<void>;
  getItem(id: string): Promise<Item | null>;
  deleteItem(id: string): Promise<void>;
  listItems(filter: "unresolved" | "due" | "flagged" | "all"): Promise<Item[]>;
  putAction(a: Action): Promise<void>;
  listActions(itemId: string): Promise<Action[]>;
  putObject(o: StoredObject): Promise<void>;
  listObjects(): Promise<StoredObject[]>;
  getPreferences(): Promise<Preferences>;
  putPreferences(p: Preferences): Promise<void>;
}
```

- [ ] **Step 4: Implement** — replace `src/storage/fileStore.ts`

```ts
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Store } from "./types.js";
import { PreferencesSchema, type Action, type Item, type Scan, type StoredObject } from "../domain/model.js";

const ID_PATTERN = /^[a-z]+_[a-z0-9-]{1,64}$/;

export function assertSafeId(id: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new Error(`Invalid id: ${id}`);
  }
}

export function createFileStore(dir: string): Store {
  const itemsDir = join(dir, "items");
  const scansDir = join(dir, "scans");
  const actionsDir = join(dir, "actions");
  mkdirSync(itemsDir, { recursive: true });
  mkdirSync(scansDir, { recursive: true });
  mkdirSync(actionsDir, { recursive: true });

  const readJson = <T>(p: string): T | null => {
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, "utf8")) as T;
    } catch (err) {
      console.error(`[fileStore] skipping unreadable file ${p}:`, err);
      return null;
    }
  };
  const writeJson = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 2), "utf8");
  const readActions = (itemId: string): Action[] => {
    assertSafeId(itemId);
    const v = readJson<Action[]>(join(actionsDir, `${itemId}.json`));
    return Array.isArray(v) ? v : [];
  };
  const isFlagged = (item: Item): boolean =>
    item.class === "scam" ||
    readActions(item.itemId).some((a) => a.type === "flag" && (a.status === "done" || a.status === "confirmed"));

  return {
    async putScan(s) { assertSafeId(s.scanId); writeJson(join(scansDir, `${s.scanId}.json`), s); },
    async getScan(id) { assertSafeId(id); return readJson<Scan>(join(scansDir, `${id}.json`)); },
    async putItem(i) { assertSafeId(i.itemId); writeJson(join(itemsDir, `${i.itemId}.json`), i); },
    async getItem(id) { assertSafeId(id); return readJson<Item>(join(itemsDir, `${id}.json`)); },
    async deleteItem(id) { assertSafeId(id); rmSync(join(itemsDir, `${id}.json`), { force: true }); },
    async listItems(filter) {
      const all = readdirSync(itemsDir)
        .map((f) => readJson<Item>(join(itemsDir, f)))
        .filter((i): i is Item => i !== null);
      if (filter === "all") return all;
      if (filter === "unresolved") return all.filter((i) => i.resolvedAt === null);
      if (filter === "flagged") return all.filter(isFlagged);
      const today = new Date().toISOString().slice(0, 10);
      return all.filter((i) => i.resolvedAt === null && i.fields.dueDate !== undefined && i.fields.dueDate <= today);
    },
    async putAction(a) {
      assertSafeId(a.itemId);
      const existing = readActions(a.itemId).filter((x) => x.actionId !== a.actionId);
      existing.push(a);
      writeJson(join(actionsDir, `${a.itemId}.json`), existing);
    },
    async listActions(itemId) { return readActions(itemId); },
    async putObject(o) { assertSafeId(o.objectId); writeJson(join(dir, `object-${o.objectId}.json`), o); },
    async listObjects() {
      return readdirSync(dir).filter((f) => f.startsWith("object-"))
        .map((f) => readJson<StoredObject>(join(dir, f)))
        .filter((o): o is StoredObject => o !== null);
    },
    async getPreferences() { return PreferencesSchema.parse(readJson(join(dir, "preferences.json")) ?? {}); },
    async putPreferences(p) { writeJson(join(dir, "preferences.json"), p); }
  };
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run test/fileStore.test.ts`
Expected: PASS. The corrupt-file test prints one `[fileStore] skipping unreadable file` log line — expected diagnostics, not a failure.

- [ ] **Step 6: Full suite, typecheck, lint, commit**

Run: `npm test; if ($?) { npm run typecheck }; if ($?) { npm run lint }`

```bash
git add src/storage/types.ts src/storage/fileStore.ts test/fileStore.test.ts
git commit -m "feat(storage): persist actions, add deleteItem, harden reads and filters"
```

---

### Task 3: Honest scam signals and atomic scan persistence

Fixes Copilot findings #5 (salutation misuse) and #6 (partial persistence).

**Files:**
- Modify: `src/domain/classifier.ts`, `src/domain/scanPipeline.ts`
- Test: `test/classifier.test.ts`, `test/scanPipeline.test.ts`

**Interfaces:**
- `Signals` gains `genericSalutation: boolean`. `senderMismatch` is now only set from real sender/return-address metadata (always `false` until Plan 3 supplies it).
- `runScan` rolls back written items if persistence fails and marks the scan `failed`.

- [ ] **Step 1: Write the failing classifier tests** — append to `test/classifier.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { classifyText, type Signals } from "../src/domain/classifier.js";

const base: Signals = { hasQrOrLink: false, hasPaymentRequest: false, senderMismatch: false, genericSalutation: false };

describe("generic salutation handling", () => {
  it("does not treat a normal bill with a generic greeting as a scam", () => {
    const r = classifyText("Dear customer, payment due on 2026-10-01.", { ...base, hasPaymentRequest: true, genericSalutation: true });
    expect(r.class).toBe("bill");
  });
  it("still flags a corroborated phishing letter", () => {
    const r = classifyText("Dear customer, urgent: pay now https://evil.example", {
      ...base, hasPaymentRequest: true, genericSalutation: true, hasQrOrLink: true
    });
    expect(r.class).toBe("scam");
  });
  it("reports a truthful reason for a generic greeting", () => {
    const r = classifyText("Dear customer, urgent: pay now https://evil.example", {
      ...base, hasPaymentRequest: true, genericSalutation: true, hasQrOrLink: true
    });
    expect(r.reasons.join(" ")).not.toMatch(/does not match the claimed organisation/);
    expect(r.reasons.join(" ")).toMatch(/generic greeting/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/classifier.test.ts`
Expected: FAIL — `genericSalutation` not part of `Signals`; grep for existing `senderMismatch` cases also need updating to the new shape.

- [ ] **Step 3: Implement** — update the top of `src/domain/classifier.ts`

Replace the `Signals` interface and the scam-scoring block (lines 3–45) with:

```ts
export interface Signals {
  hasQrOrLink: boolean;
  hasPaymentRequest: boolean;
  senderMismatch: boolean;
  genericSalutation: boolean;
}
```

and inside `classifyText`, replace the scoring block with:

```ts
  const reasons: string[] = [];
  const urgent = URGENCY.test(text);
  const gift = GIFT.test(text);
  // A bare payment request is normal on bills; only treat it as a scam signal
  // when corroborated by a link/QR, a real sender mismatch, or gift-card language.
  const corroboratedPayment = signals.hasPaymentRequest && (signals.hasQrOrLink || signals.senderMismatch || gift);

  let scamScore = 0;
  if (corroboratedPayment) { scamScore += 2; reasons.push("asks for a payment in a suspicious context"); }
  if (signals.hasQrOrLink) { scamScore += 1; reasons.push("contains a link or QR code"); }
  if (signals.senderMismatch) { scamScore += 2; reasons.push("sender does not match the claimed organisation"); }
  if (signals.genericSalutation) { scamScore += 1; reasons.push("uses a generic greeting often seen in scam mail"); }
  if (urgent) { scamScore += 2; reasons.push("uses urgent or threatening language"); }
  if (gift) { scamScore += 2; reasons.push("asks for gift-card payment"); }
  if (scamScore >= 3) {
    return { class: "scam", confidence: Math.min(0.95, 0.5 + scamScore * 0.1), reasons };
  }
```

- [ ] **Step 4: Run classifier tests to verify pass**

Run: `npx vitest run test/classifier.test.ts`
Expected: PASS. Update any pre-existing classifier test that constructs `Signals` to include `genericSalutation: false`.

- [ ] **Step 5: Write the failing pipeline rollback test** — append to `test/scanPipeline.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../src/storage/fileStore.js";
import { runScan } from "../src/domain/scanPipeline.js";
import type { Store } from "../src/storage/types.js";

describe("runScan persistence atomicity", () => {
  it("rolls back written items and marks the scan failed when a write throws", async () => {
    const real = createFileStore(mkdtempSync(join(tmpdir(), "wf-")));
    let writes = 0;
    const flaky: Store = {
      ...real,
      putItem: async (i) => { writes += 1; if (writes === 2) throw new Error("disk full"); return real.putItem(i); },
      listItems: (f) => real.listItems(f)
    };
    const scan = await runScan(flaky, {
      imageRefs: ["a"], hint: "mail",
      extractedText: ["Amount due: €10. Payment due 2026-10-01.", "Your appointment is on 2026-11-02."]
    });
    expect(scan.status).toBe("failed");
    const remaining = (await real.listItems("all")).filter((i) => i.scanId === scan.scanId);
    expect(remaining).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run test/scanPipeline.test.ts`
Expected: FAIL — first item remains persisted.

- [ ] **Step 7: Implement** — update signals and persistence in `src/domain/scanPipeline.ts`

Replace the signals object and the persistence block:

```ts
      const signals = {
        hasQrOrLink: /https?:\/\/|\bQR\b/i.test(text),
        hasPaymentRequest: /\b(?:pay|payment|transfer|überweisen)\b/i.test(text),
        // Requires real sender/return-address metadata, which the deterministic
        // pipeline does not have; Plan 3's extractor may supply it. Never infer
        // a mismatch from a salutation.
        senderMismatch: false,
        genericSalutation: /\bdear (?:customer|sir\/madam|account holder)\b/i.test(text)
      };
```

and replace the persist loop with:

```ts
  const written: string[] = [];
  try {
    for (const item of items) {
      await store.putItem(item);
      written.push(item.itemId);
    }
  } catch (err) {
    console.error(`[scanPipeline] scan ${scanId} failed while persisting:`, err);
    for (const id of written.reverse()) {
      try { await store.deleteItem(id); } catch (e) { console.error(`[scanPipeline] rollback of ${id} failed:`, e); }
    }
    const failed: Scan = { ...scan, status: "failed" };
    await store.putScan(failed);
    return failed;
  }
```

- [ ] **Step 8: Run to verify pass, then full gates and commit**

Run: `npx vitest run test/scanPipeline.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`

```bash
git add src/domain/classifier.ts src/domain/scanPipeline.ts test/classifier.test.ts test/scanPipeline.test.ts
git commit -m "fix(domain): stop inferring sender mismatch and make scan persistence atomic"
```

---

### Task 4: Explicit extractor-unavailable signaling

Fixes Copilot finding #2: the production entry point wires no `extract`, so `capture_scan` currently reports the blurry-image message and writes a `failed` scan for every request. Correct behavior is to say reading is not available yet.

**Files:**
- Modify: `src/domain/copy.ts`, `src/mcp/server.ts`, `src/server/index.ts`
- Test: `test/tools.test.ts`

**Interfaces:**
- `copy.readerUnavailable: string` (new).
- `capture_scan` returns `structuredContent: { available: false, count: 0 }` and the `readerUnavailable` text when no extractor is configured, and does **not** write a scan.

- [ ] **Step 1: Write the failing test** — create `test/tools.test.ts`

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/tools.test.ts`
Expected: FAIL — `copy.readerUnavailable` undefined; behavior returns `scanFailed`.

- [ ] **Step 3: Implement** — add to `src/domain/copy.ts` inside the object

```ts
  readerUnavailable: "I can't read photos on this device yet — that part isn't set up.",
```

- [ ] **Step 4: Implement** — guard in `src/mcp/server.ts` `capture_scan`

Replace the `capture_scan` handler body's opening with:

```ts
    async ({ imageRefs, hint }) => {
      if (!deps.extract) {
        return {
          content: [{ type: "text", text: copy.readerUnavailable }],
          structuredContent: { available: false, count: 0 }
        };
      }
      let extractedText: string[];
      try {
        extractedText = await deps.extract(imageRefs, hint);
      } catch (err) {
        console.error("[capture_scan] extractor failed:", err);
        extractedText = [];
      }
      const scan = await runScan(deps.store, { imageRefs, hint, extractedText });
      const items = await deps.store.listItems("all");
      const mine = items.filter((i) => i.scanId === scan.scanId);
      return {
        content: [{ type: "text", text: mine.length ? `I read ${mine.length} item(s).` : copy.scanFailed }],
        structuredContent: { scanId: scan.scanId, count: mine.length, available: true }
      };
    }
```

- [ ] **Step 5: Implement** — log extractor state in `src/server/index.ts`

```ts
const app = createHttpApp({ store: createFileStore(dir) });
const port = Number(process.env.PORT ?? 8080);
console.log("[wayfinder] extractor configured:", process.env.WAYFINDER_EXTRACTOR === "bedrock");
```

- [ ] **Step 6: Run to verify pass, gates, commit**

Run: `npx vitest run test/tools.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`

```bash
git add src/domain/copy.ts src/mcp/server.ts src/server/index.ts test/tools.test.ts
git commit -m "fix(mcp): signal reader-unavailable instead of failing every production scan"
```

---

### Task 5: Origin validation and loopback default bind

Fixes Copilot findings #3 and #4; both are MCP security requirements (Origin validation MUST; local bind SHOULD be loopback).

**Files:**
- Modify: `src/server/http.ts`, `src/server/index.ts`
- Test: `test/origin.test.ts`

**Interfaces:**
- `createHttpApp(deps: { store: Store; extract?: Extractor; allowedOrigins?: string[] })`.
- `isAllowedOrigin(origin: string | undefined, extra: string[]): boolean` (exported).
- `resolveHost(env?: NodeJS.ProcessEnv): string` (exported; default `127.0.0.1`).
- Disallowed `Origin` → HTTP **403** with a JSON-RPC error body and no body processing.

- [ ] **Step 1: Write the failing tests** — create `test/origin.test.ts`

```ts
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
  it("accepts a loopback Origin", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", origin: "http://localhost:5173" }, body: JSON.stringify(initBody)
    });
    expect(res.status).not.toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/origin.test.ts`
Expected: FAIL — `isAllowedOrigin`/`resolveHost` not exported; evil origin not rejected.

- [ ] **Step 3: Implement** — update `src/server/http.ts`

```ts
import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Store } from "../storage/types.js";
import type { Extractor } from "../domain/scanPipeline.js";
import { buildServer } from "../mcp/server.js";

export function isAllowedOrigin(origin: string | undefined, extra: string[]): boolean {
  if (origin === undefined || origin === "") return true; // non-browser clients omit Origin
  let url: URL;
  try { url = new URL(origin); } catch { return false; }
  const host = url.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return true;
  return extra.includes(origin);
}

export function resolveHost(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOST ?? "127.0.0.1";
}

export function createHttpApp(deps: { store: Store; extract?: Extractor; allowedOrigins?: string[] }) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const allowed = deps.allowedOrigins ?? [];
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.get("/healthz", (_req, res) => { res.json({ ok: true }); });

  const handle = async (req: express.Request, res: express.Response) => {
    if (!isAllowedOrigin(req.headers.origin, allowed)) {
      res.status(403).json({ jsonrpc: "2.0", error: { code: -32000, message: "Forbidden: origin not allowed" }, id: null });
      return;
    }
    const sessionId = req.headers["mcp-session-id"];
    let transport: StreamableHTTPServerTransport | undefined =
      typeof sessionId === "string" ? transports.get(sessionId) : undefined;
    if (!transport) {
      if (req.method === "POST" && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => { transports.set(sid, transport!); }
        });
        transport.onclose = () => {
          if (transport!.sessionId) transports.delete(transport!.sessionId);
        };
        await buildServer(deps).connect(transport as unknown as Transport);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID provided" },
          id: null
        });
        return;
      }
    }
    await transport.handleRequest(req, res, req.body);
  };

  app.post("/mcp", handle);
  app.get("/mcp", handle);
  app.delete("/mcp", handle);
  return app;
}
```

- [ ] **Step 4: Implement** — `src/server/index.ts`

```ts
import { createHttpApp, resolveHost } from "./http.js";
import { createFileStore } from "../storage/fileStore.js";

const dir = process.env.WAYFINDER_DATA_DIR ?? "data";
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const app = createHttpApp({ store: createFileStore(dir), allowedOrigins });
const port = Number(process.env.PORT ?? 8080);
const host = resolveHost();
app.listen(port, host, () => console.log(`Wayfinder MCP server on ${host}:${port}`));
```

`resolveHost` is defined and exported in `http.ts` (Step 3) so tests can import it without starting a listener; `index.ts` only imports and calls it.

- [ ] **Step 5: Run to verify pass, gates, commit**

Run: `npx vitest run test/origin.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`

```bash
git add src/server/http.ts src/server/index.ts test/origin.test.ts
git commit -m "fix(server): enforce Origin validation and bind loopback by default"
```

---

### Task 6: `applyAction` domain function and `act_on_item` tool

**Files:**
- Create: `src/domain/applyAction.ts`
- Modify: `src/mcp/server.ts`, `src/domain/copy.ts`
- Test: `test/applyAction.test.ts`

**Interfaces:**
- `applyAction(store: Store, itemId: string, actionId: string): Promise<{ item: Item; action: Action; message: string }>`.
- Tool `act_on_item({ itemId, actionId })`.

- [ ] **Step 1: Write the failing tests** — create `test/applyAction.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../src/storage/fileStore.js";
import { applyAction } from "../src/domain/applyAction.js";
import type { Item } from "../src/domain/model.js";

let store: ReturnType<typeof createFileStore>;
beforeEach(() => { store = createFileStore(mkdtempSync(join(tmpdir(), "wf-"))); });

const item = (over: Partial<Item> = {}): Item => ({
  itemId: "itm_a", scanId: "scn_a", class: "bill", confidence: 0.8, readAloudText: "bill",
  fields: { dueDate: "2026-10-01" },
  proposedActions: [{ actionId: "itm_a:remind", itemId: "itm_a", type: "remind", params: { on: "2026-10-01" }, status: "proposed" }],
  createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null, ...over
});

describe("applyAction", () => {
  it("marks a remind action done and leaves the item unresolved", async () => {
    await store.putItem(item());
    const r = await applyAction(store, "itm_a", "itm_a:remind");
    expect(r.action.status).toBe("done");
    expect(r.item.resolvedAt).toBeNull();
    expect((await store.listActions("itm_a"))[0]!.status).toBe("done");
  });

  it("resolves the item for file and discard", async () => {
    await store.putItem(item({
      proposedActions: [{ actionId: "itm_a:file", itemId: "itm_a", type: "file", params: {}, status: "proposed" }]
    }));
    const r = await applyAction(store, "itm_a", "itm_a:file");
    expect(r.item.resolvedAt).not.toBeNull();
  });

  it("is idempotent for an already-done action", async () => {
    await store.putItem(item({
      proposedActions: [{ actionId: "itm_a:file", itemId: "itm_a", type: "file", params: {}, status: "done" }]
    }));
    const r = await applyAction(store, "itm_a", "itm_a:file");
    expect(r.action.status).toBe("done");
  });

  it("refuses share without a trusted contact", async () => {
    await store.putItem(item({
      proposedActions: [{ actionId: "itm_a:share", itemId: "itm_a", type: "share", params: {}, status: "proposed" }]
    }));
    await expect(applyAction(store, "itm_a", "itm_a:share")).rejects.toThrow();
  });

  it("refuses an unknown action", async () => {
    await store.putItem(item());
    await expect(applyAction(store, "itm_a", "itm_a:nope")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/applyAction.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/domain/applyAction.ts`

```ts
import type { Store } from "../storage/types.js";
import type { Action, Item } from "./model.js";

export interface ApplyResult {
  item: Item;
  action: Action;
  message: string;
}

export async function applyAction(store: Store, itemId: string, actionId: string): Promise<ApplyResult> {
  const item = await store.getItem(itemId);
  if (!item) throw new Error("Unknown item.");
  const action = item.proposedActions.find((a) => a.actionId === actionId);
  if (!action) throw new Error("Unknown action.");

  if (action.status === "done" || action.status === "confirmed") {
    return { item, action, message: "That's already done." };
  }

  if (action.type === "remind" && typeof action.params.on !== "string") {
    throw new Error("This reminder has no date.");
  }
  if (action.type === "schedule" && typeof action.params.at !== "string") {
    throw new Error("This appointment has no time.");
  }

  const preferences = await store.getPreferences();
  const now = new Date().toISOString();
  let resolvedAt = item.resolvedAt;
  let message: string;

  switch (action.type) {
    case "remind": message = "I'll remind you about that."; break;
    case "schedule": message = "I've added that to your calendar."; break;
    case "flag": message = "I've flagged that for you."; break;
    case "file": resolvedAt = now; message = "Filed."; break;
    case "discard": resolvedAt = now; message = "Discarded."; break;
    case "share":
      if (!preferences.trustedContactAlias) throw new Error("No trusted contact is set up.");
      message = `Shared with ${preferences.trustedContactAlias}.`;
      break;
  }

  const done: Action = { ...action, status: "done" };
  const updatedItem: Item = {
    ...item,
    resolvedAt,
    proposedActions: item.proposedActions.map((a) => (a.actionId === action.actionId ? done : a))
  };
  await store.putItem(updatedItem);
  await store.putAction(done);
  return { item: updatedItem, action: done, message };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/applyAction.test.ts`
Expected: PASS.

- [ ] **Step 5: Register the tool in `src/mcp/server.ts`**

Add the import and the tool registration before `return server;`:

```ts
import { applyAction } from "../domain/applyAction.js";
```

```ts
  server.tool(
    "act_on_item",
    "Carry out one of the suggested actions for an item after the customer confirms it.",
    { itemId: z.string(), actionId: z.string() },
    async ({ itemId, actionId }) => {
      try {
        const result = await applyAction(deps.store, itemId, actionId);
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: { action: result.action, item: result.item }
        };
      } catch (err) {
        console.error("[act_on_item] failed:", err);
        return {
          content: [{ type: "text", text: "I couldn't do that — please choose the action again." }],
          isError: true
        };
      }
    }
  );
```

- [ ] **Step 6: Gates and commit**

Run: `npm test; if ($?) { npm run typecheck }; if ($?) { npm run lint }`

```bash
git add src/domain/applyAction.ts src/mcp/server.ts test/applyAction.test.ts
git commit -m "feat(mcp): add applyAction domain function and act_on_item tool"
```

---

### Task 7: Remaining tools, label parsing, and the label disclaimer

Fixes Copilot finding #7 and completes the tool surface from spec §8.1: `list_items`, `get_item`, `update_preferences`, `identify_product`, `daily_briefing`.

**Files:**
- Create: `src/domain/labelParser.ts`
- Modify: `src/mcp/server.ts`, `src/domain/copy.ts`
- Test: `test/labelParser.test.ts`, `test/tools.test.ts`

**Interfaces:**
- `parseLabel(text: string): { name: string; details: string[]; labelText: string; disclaimer: string }`.
- `get_scan` and `get_item` append `copy.disclaimers.label` for `label`-class items.

- [ ] **Step 1: Write the failing label parser tests** — create `test/labelParser.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseLabel } from "../src/domain/labelParser.js";
import { copy } from "../src/domain/copy.js";

describe("parseLabel", () => {
  it("keeps label text verbatim and attaches the disclaimer", () => {
    const parsed = parseLabel("Ibuprofen 400mg\nBest before 2027-03\nContains lactose");
    expect(parsed.labelText).toContain("Ibuprofen 400mg");
    expect(parsed.name).toBe("Ibuprofen 400mg");
    expect(parsed.details.join(" ")).toMatch(/Best before/);
    expect(parsed.disclaimer).toBe(copy.disclaimers.label);
  });
  it("never invents medical advice", () => {
    const parsed = parseLabel("Some product\nIngredients: water, salt");
    expect(parsed.labelText).toBe("Some product\nIngredients: water, salt");
    expect(parsed.disclaimer).toMatch(/not medical advice/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/labelParser.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/domain/labelParser.ts`

```ts
import { copy } from "./copy.js";

export interface ParsedLabel {
  name: string;
  details: string[];
  labelText: string;
  disclaimer: string;
}

const DETAIL = /(ingredients|allergen|best before|use by|expiry|expires|contains|may contain|energy|nutrition)/i;

export function parseLabel(text: string): ParsedLabel {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const name = lines[0] ?? "";
  const details = lines.filter((l) => DETAIL.test(l));
  return { name, details, labelText: text, disclaimer: copy.disclaimers.label };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/labelParser.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the remaining tools to `src/mcp/server.ts`**

Add imports:

```ts
import { parseLabel } from "../domain/labelParser.js";
import { redactSensitive } from "../domain/redact.js";
```

Append before `return server;`:

```ts
  server.tool(
    "list_items",
    "List the customer's items, optionally filtered to unresolved, due, or flagged.",
    { filter: z.enum(["unresolved", "due", "flagged", "all"]).default("unresolved") },
    async ({ filter }) => {
      const items = await deps.store.listItems(filter);
      return {
        content: [{ type: "text", text: items.length ? `${items.length} item(s).` : copy.nothingFound }],
        structuredContent: { items }
      };
    }
  );

  server.tool(
    "get_item",
    "Return one item's full detail and read-aloud text.",
    { itemId: z.string() },
    async ({ itemId }) => {
      const item = await deps.store.getItem(itemId);
      if (!item) {
        return { content: [{ type: "text", text: copy.nothingFound }], isError: true };
      }
      const text = item.class === "label" ? `${item.readAloudText} ${copy.disclaimers.label}` : item.readAloudText;
      return { content: [{ type: "text", text }], structuredContent: { item } };
    }
  );

  server.tool(
    "update_preferences",
    "Update the customer's preferences such as verbosity or trusted contact.",
    {
      verbosity: z.enum(["brief", "normal", "detailed"]).optional(),
      trustedContactAlias: z.string().nullable().optional(),
      largeText: z.boolean().optional()
    },
    async (patch) => {
      const current = await deps.store.getPreferences();
      const updated = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
      await deps.store.putPreferences(updated);
      return { content: [{ type: "text", text: "Preferences saved." }], structuredContent: { preferences: updated } };
    }
  );

  server.tool(
    "identify_product",
    "Read a product, food, or medication label back to the customer, verbatim.",
    { imageRefs: z.array(z.string()).min(1) },
    async ({ imageRefs }) => {
      if (!deps.extract) {
        return { content: [{ type: "text", text: copy.readerUnavailable }], structuredContent: { available: false } };
      }
      let texts: string[];
      try {
        texts = await deps.extract(imageRefs, "label");
      } catch (err) {
        console.error("[identify_product] extractor failed:", err);
        texts = [];
      }
      const labelText = redactSensitive(texts.join(" ").trim());
      if (!labelText) {
        return { content: [{ type: "text", text: copy.nothingFound }], structuredContent: { available: true } };
      }
      const parsed = parseLabel(labelText);
      return {
        content: [{ type: "text", text: `${parsed.name}. ${parsed.disclaimer}` }],
        structuredContent: parsed
      };
    }
  );

  server.tool(
    "daily_briefing",
    "Give the customer a summary of what is due, upcoming, or flagged.",
    {},
    async () => {
      const [due, flagged, objects] = await Promise.all([
        deps.store.listItems("due"),
        deps.store.listItems("flagged"),
        deps.store.listObjects()
      ]);
      const summary =
        due.length + flagged.length + objects.length > 0
          ? `You have ${due.length} due, ${flagged.length} flagged.`
          : "Nothing needs your attention today.";
      return { content: [{ type: "text", text: summary }], structuredContent: { due, flagged, objects } };
    }
  );
```

- [ ] **Step 6: Fix the label disclaimer in `get_scan`**

In the `get_scan` handler, replace the text join with:

```ts
      const spoken = items
        .map((i) => (i.class === "label" ? `${i.readAloudText} ${copy.disclaimers.label}` : i.readAloudText))
        .join(" ");
      return {
        content: [{ type: "text", text: spoken || copy.nothingFound }],
        structuredContent: { items }
      };
```

- [ ] **Step 7: Add tool tests** — append to `test/tools.test.ts`

```ts
describe("label disclaimer", () => {
  it("appends the disclaimer when reading a label item", async () => {
    const { client, store } = await connect();
    await store.putItem({
      itemId: "itm_lab", scanId: "scn_x", class: "label", confidence: 0.9,
      readAloudText: "Ibuprofen 400mg", fields: {}, proposedActions: [],
      createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null
    });
    const res = await client.callTool({ name: "get_item", arguments: { itemId: "itm_lab" } });
    expect(JSON.stringify(res.content)).toContain(copy.disclaimers.label);
    await client.close();
  });
});

describe("update_preferences", () => {
  it("merges a patch into preferences", async () => {
    const { client, store } = await connect();
    await client.callTool({ name: "update_preferences", arguments: { verbosity: "brief" } });
    expect((await store.getPreferences()).verbosity).toBe("brief");
    await client.close();
  });
});
```

- [ ] **Step 8: Gates and commit**

Run: `npm test; if ($?) { npm run typecheck }; if ($?) { npm run lint }`

```bash
git add src/domain/labelParser.ts src/domain/copy.ts src/mcp/server.ts test/labelParser.test.ts test/tools.test.ts
git commit -m "feat(mcp): add remaining tools, label parsing, and the label disclaimer"
```

---

### Task 8: Resources and the morning-briefing prompt

Completes spec §8.1 (`wayfinder://inbox`, `wayfinder://objects`, `morning_briefing`).

**Files:**
- Modify: `src/mcp/server.ts`
- Test: `test/tools.test.ts`

**Interfaces:**
- Resource `wayfinder://inbox` → JSON of unresolved items.
- Resource `wayfinder://objects` → JSON of stored objects.
- Prompt `morning_briefing` → a single user message instructing the brief.

- [ ] **Step 1: Write the failing tests** — append to `test/tools.test.ts`

```ts
describe("resources and prompt", () => {
  it("lists both resources and reads the inbox", async () => {
    const { client, store } = await connect();
    await store.putItem({
      itemId: "itm_i", scanId: "scn_x", class: "bill", confidence: 0.8, readAloudText: "bill",
      fields: {}, proposedActions: [], createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null
    });
    const list = await client.listResources();
    expect(list.resources.map((r) => r.uri).sort()).toEqual(["wayfinder://inbox", "wayfinder://objects"]);
    const read = await client.readResource({ uri: "wayfinder://inbox" });
    expect(JSON.stringify(read.contents)).toContain("itm_i");
    await client.close();
  });

  it("exposes the morning_briefing prompt", async () => {
    const { client } = await connect();
    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((p) => p.name)).toContain("morning_briefing");
    const got = await client.getPrompt({ name: "morning_briefing" });
    expect(got.messages.length).toBeGreaterThan(0);
    await client.close();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/tools.test.ts`
Expected: FAIL — resources/prompt not registered.

- [ ] **Step 3: Implement** — append to `src/mcp/server.ts` before `return server;`

```ts
  server.resource(
    "inbox",
    "wayfinder://inbox",
    { description: "The customer's unresolved items." },
    async (uri) => {
      const items = await deps.store.listItems("unresolved");
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ items }) }] };
    }
  );

  server.resource(
    "objects",
    "wayfinder://objects",
    { description: "Remembered household objects and their last-seen locations." },
    async (uri) => {
      const objects = await deps.store.listObjects();
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ objects }) }] };
    }
  );

  server.prompt(
    "morning_briefing",
    "Start the day by summarizing what needs the customer's attention.",
    {},
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Give me my morning briefing: what is due, what appointments are coming, and anything flagged."
          }
        }
      ]
    })
  );
```

- [ ] **Step 4: Run to verify pass, gates, commit**

Run: `npx vitest run test/tools.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`

```bash
git add src/mcp/server.ts test/tools.test.ts
git commit -m "feat(mcp): expose inbox/objects resources and morning_briefing prompt"
```

---

## Self-Review

**Spec coverage (Plan 2 scope):** tools `act_on_item`, `list_items`, `get_item`, `identify_product`, `daily_briefing`, `update_preferences` (§8.1); resources and prompt (§8.1); real action persistence and `flagged`/`due` semantics (§9, §10.3); Origin validation (§11, MCP security); loopback bind (§11); label disclaimer and verbatim read-back (§9.3, §13); grouped account masking (§5, §9.3). Remaining spec areas — MCP Apps UI (§12), Bedrock brain (§13), simulated client and classic skill (§14), AWS deploy (§15) — are Plans 3–5.

**Placeholder scan:** none — every step carries real code.

**Type consistency:** `Signals` gains `genericSalutation` and Task 3 updates both the pipeline and classifier tests that construct it. `Store` gains `deleteItem`, implemented in Task 2 and consumed by Task 3's rollback. Tool names and parameters match spec §8.1. `applyAction` returns `{ item, action, message }` and the `act_on_item` tool surfaces exactly that.

**Ordering:** Task 2 (`deleteItem`, action persistence) precedes Task 3 (rollback). Task 4 (`copy.readerUnavailable`) precedes Task 7 (`identify_product`). Task 8 depends on Task 2's `listItems("unresolved")`.

**Known follow-up:** full OAuth (spec §11 two-tier) and MCP Apps rendering remain in Plans 4 and 3; `senderMismatch` stays `false` until Plan 3 can supply real sender metadata.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-09-19-wayfinder-mcp-surface.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute in this session with checkpoints.

Which approach?
