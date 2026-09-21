# Wayfinder v2 — Plan 6: Persisted Records & Governed Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the v2 `DocumentRecord` and tamper-evident ledger, wire capture and action-taking to the Plan 5 domain core, and expose the five new / two changed MCP tools — making the three pillars of the v2 thesis real without touching the UI or the ports layer.

**Architecture:** Plan 5's domain modules stay pure and I/O-free. Plan 6 adds thin adapters around them: `fileStore` gains ledger persistence, new small domain orchestrators (`ledgerLog`, `lifecycle`, `readback`, `backlog`) compose the pure functions over a `Store`, `scans.ts` and `applyAction.ts` become the two write paths, and `mcp/server.ts` exposes the tools. The persisted unit is still `Item` with its optional `record`; `DocumentRecord` and `Thread` remain derived views.

**Tech Stack:** TypeScript 5 (ESM), `zod` 3.25, `node:crypto` (SHA-256), `vitest`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-20-wayfinder-v2-verifiable-agency.md` (§2, §3, §4, §5)

## Global Constraints

- Node **22+**; ESM (`"type": "module"`).
- The domain core stays **pure**: no I/O, no network, no model calls, no `Date.now()` inside hashing/decision logic — callers pass `now`. `ledgerLog`, `backlog`, `readback`, `lifecycle` orchestrate I/O but contain no transport.
- `tsconfig` enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Optional properties are **added conditionally**, never assigned `undefined`.
- `record` on `Item` is **optional**; legacy items (no `record`) must keep working, including the **250 tests currently green**.
- `lifecycle` is the authoritative state field. `Item.resolvedAt` is retained for compatibility and set to a timestamp **exactly when** `lifecycle` first reaches `closed`; it is **never read to infer lifecycle**. `w1`'s `resolvedAt`-based `listItems` filters move to `lifecycle`.
- Account numbers stay masked; `LedgerEntry.details` passes through `redactSensitive` before hashing. Because `redactSensitive` masks 7+ digit runs, ledger details must keep monetary amounts as **numbers**, never strings.
- `evaluateAuthority` is the single source of truth for the action decision. Plan 6 **widens** its result to `"allow" | "confirm" | "refuse" | "escalate"`.
- Plan 6 does **not** touch: the MCP App screens / `UI_TOOLS` / `ui` meta wiring (Plan 8), or the six ports and `wayfinder://capabilities` (Plan 7). The two new resources/tools here are registered with plain `server.tool` / `server.resource`, not `registerAppTool`.
- Out of scope, permanently: payment execution, advice, emergency response.
- Commits use the message given in each task. Stage only the files named in the task.

---

## File Structure

```
src/storage/types.ts        MODIFY Store: add listLedger, putLedgerEntry
src/storage/fileStore.ts    MODIFY persist ledger.json; lifecycle-based item filters
src/domain/ledgerLog.ts     CREATE createLedger — serialized append/read/verify over a Store
src/domain/lifecycle.ts     CREATE lifecycleOf, withLifecycle
src/domain/readback.ts      CREATE assessReadback (deterministic abstention)
src/domain/backlog.ts       CREATE buildBacklog, describeThread
src/domain/authority.ts     MODIFY decision union gains "escalate"; add DEFAULT_AUTHORITY
src/domain/scans.ts         MODIFY produce record; append ingested + triaged
src/domain/applyAction.ts   MODIFY authority gate; ledger events; lifecycle transitions
src/domain/copy.ts          MODIFY spoken copy for backlog, ledger, audit, escalation
src/mcp/server.ts           MODIFY 5 new tools, act_on_item + daily_briefing changes, ledger resource
test/ledgerStore.test.ts    CREATE
test/ledgerLog.test.ts      CREATE
test/lifecycle.test.ts      CREATE
test/readback.test.ts       CREATE
test/backlog.test.ts        CREATE
test/authorityGate.test.ts  CREATE
test/governedTools.test.ts  CREATE
test/fileStore.test.ts      MODIFY lifecycle filters
test/scans.test.ts          MODIFY record + ledger assertions
test/authority.test.ts      MODIFY escalate expectation
test/tools.test.ts          MODIFY ledger resource in the resource list
```

---

### Task 1: Persist the ledger in the store

**Files:**
- Modify: `src/storage/types.ts`
- Modify: `src/storage/fileStore.ts`
- Test: `test/ledgerStore.test.ts`

**Interfaces:**
- Consumes: `LedgerEntry`, `LedgerEntrySchema` from `src/domain/model.ts`.
- Produces: `Store.listLedger(): Promise<LedgerEntry[]>` and `Store.putLedgerEntry(e: LedgerEntry): Promise<void>`, backed by a schema-validated `ledger.json`.

- [ ] **Step 1: Write the failing test** — create `test/ledgerStore.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../src/storage/fileStore.js";
import type { LedgerEntry } from "../src/domain/model.js";

const entry = (seq: number): LedgerEntry => ({
  seq, entryId: `led_${seq}`, at: "2026-09-20T12:00:00.000Z", actor: "agent",
  event: "ingested", documentId: "itm_1", details: {},
  prevHash: "0".repeat(64), hash: "h".repeat(64)
});

let dir: string;
let store: ReturnType<typeof createFileStore>;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "wf-")); store = createFileStore(dir); });

describe("ledger persistence", () => {
  it("returns an empty ledger for a fresh store", async () => {
    expect(await store.listLedger()).toEqual([]);
  });

  it("appends entries in order and reads them back", async () => {
    await store.putLedgerEntry(entry(1));
    await store.putLedgerEntry(entry(2));
    expect((await store.listLedger()).map((e) => e.seq)).toEqual([1, 2]);
  });

  it("skips a parseable-but-invalid ledger entry", async () => {
    await store.putLedgerEntry(entry(1));
    writeFileSync(join(dir, "ledger.json"), JSON.stringify([entry(1), {}]), "utf8");
    expect((await store.listLedger()).map((e) => e.seq)).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ledgerStore.test.ts`
Expected: FAIL — `store.listLedger is not a function` (`putLedgerEntry` not on the store).

- [ ] **Step 3a: Extend the `Store` interface** — modify `src/storage/types.ts`

Change the import line to include `LedgerEntry`:

```ts
import type { Scan, Item, Action, StoredObject, Preferences, LedgerEntry } from "../domain/model.js";
```

Add these two lines inside `interface Store`, after `putPreferences`:

```ts
  listLedger(): Promise<LedgerEntry[]>;
  putLedgerEntry(e: LedgerEntry): Promise<void>;
```

- [ ] **Step 3b: Implement in `fileStore`** — modify `src/storage/fileStore.ts`

Extend the model import to include `LedgerEntrySchema` and the type:

```ts
import {
  ActionSchema, ItemSchema, LedgerEntrySchema, PreferencesSchema, ScanSchema, StoredObjectSchema,
  type Action, type Item, type LedgerEntry, type Scan, type StoredObject
} from "../domain/model.js";
```

Add a reader next to `readActions` (after the `isFlagged` definition):

```ts
  const readLedger = (): LedgerEntry[] => {
    const raw = readJson<unknown>(join(dir, "ledger.json"));
    if (!Array.isArray(raw)) return [];
    const entries: LedgerEntry[] = [];
    for (const entry of raw) {
      const parsed = LedgerEntrySchema.safeParse(entry);
      if (!parsed.success) {
        console.error("[fileStore] skipping invalid ledger entry:", parsed.error);
        continue;
      }
      entries.push(parsed.data);
    }
    return entries;
  };
```

Add the two methods at the end of the returned object, after `putPreferences`:

```ts
    async listLedger() { return readLedger(); },
    async putLedgerEntry(e) {
      const entries = readLedger();
      entries.push(e);
      writeJson(join(dir, "ledger.json"), entries);
    }
```

- [ ] **Step 4: Run the test, then the full gates**

Run: `npx vitest run test/ledgerStore.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: the new tests pass and all 250 prior tests stay green.

- [ ] **Step 5: Commit**

```bash
git add src/storage/types.ts src/storage/fileStore.ts test/ledgerStore.test.ts
git commit -m "feat(storage): persist the tamper-evident ledger"
```

---

### Task 2: Serialized ledger appender

**Files:**
- Create: `src/domain/ledgerLog.ts`
- Test: `test/ledgerLog.test.ts`

**Interfaces:**
- Consumes: `appendLedgerEntry`, `verifyLedger` from `src/domain/ledger.js`; `LedgerEntry`, `LedgerEvent` from `src/domain/model.js`; a store with `listLedger`/`putLedgerEntry` (Task 1).
- Produces:
  - `LedgerStore = Pick<Store, "listLedger" | "putLedgerEntry">`
  - `LedgerAppendInput = { at: string; actor: "agent" | "user"; event: LedgerEvent; documentId?: string; threadKey?: string; details?: Record<string, unknown>; entryId?: string }`
  - `interface Ledger { append(input: LedgerAppendInput): Promise<LedgerEntry>; read(): Promise<LedgerEntry[]>; verify(): Promise<{ ok: boolean; entries: number; firstMismatchSeq?: number }> }`
  - `createLedger(store: LedgerStore): Ledger` — **one instance per store** (cached), so all callers share a single append queue.

- [ ] **Step 1: Write the failing test** — create `test/ledgerLog.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../src/storage/fileStore.js";
import { createLedger } from "../src/domain/ledgerLog.js";

let store: ReturnType<typeof createFileStore>;
beforeEach(() => { store = createFileStore(mkdtempSync(join(tmpdir(), "wf-"))); });

const input = (event: "ingested" | "triaged" | "closed") => ({
  at: "2026-09-20T12:00:00.000Z", actor: "agent" as const, event
});

describe("createLedger", () => {
  it("numbers and links entries as it appends", async () => {
    const ledger = createLedger(store);
    await ledger.append(input("ingested"));
    await ledger.append(input("triaged"));
    const entries = await ledger.read();
    expect(entries.map((e) => e.seq)).toEqual([1, 2]);
    expect(entries[1]!.prevHash).toBe(entries[0]!.hash);
    expect((await ledger.verify()).ok).toBe(true);
  });

  it("serializes concurrent appends into one intact chain", async () => {
    const ledger = createLedger(store);
    await Promise.all([
      ledger.append(input("ingested")),
      ledger.append(input("triaged")),
      ledger.append(input("closed")),
      ledger.append(input("ingested")),
      ledger.append(input("triaged"))
    ]);
    const result = await ledger.verify();
    expect(result).toEqual({ ok: true, entries: 5 });
  });

  it("returns the same instance for the same store", () => {
    expect(createLedger(store)).toBe(createLedger(store));
  });

  it("keeps appending after a failed write", async () => {
    let failNext = true;
    const flaky = {
      listLedger: () => store.listLedger(),
      putLedgerEntry: async (e: Parameters<typeof store.putLedgerEntry>[0]) => {
        if (failNext) { failNext = false; throw new Error("disk hiccup"); }
        return store.putLedgerEntry(e);
      }
    };
    const ledger = createLedger(flaky);
    await expect(ledger.append(input("ingested"))).rejects.toThrow();
    await ledger.append(input("triaged"));
    const entries = await ledger.read();
    expect(entries.map((e) => e.seq)).toEqual([1]);
    expect((await ledger.verify()).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ledgerLog.test.ts`
Expected: FAIL — module `src/domain/ledgerLog.js` not found.

- [ ] **Step 3: Implement** — create `src/domain/ledgerLog.ts`

```ts
import { randomUUID } from "node:crypto";
import type { Store } from "../storage/types.js";
import type { LedgerEntry, LedgerEvent } from "./model.js";
import { appendLedgerEntry, verifyLedger } from "./ledger.js";

export type LedgerStore = Pick<Store, "listLedger" | "putLedgerEntry">;

export interface LedgerAppendInput {
  at: string;
  actor: "agent" | "user";
  event: LedgerEvent;
  documentId?: string;
  threadKey?: string;
  details?: Record<string, unknown>;
  entryId?: string;
}

export interface Ledger {
  append(input: LedgerAppendInput): Promise<LedgerEntry>;
  read(): Promise<LedgerEntry[]>;
  verify(): Promise<{ ok: boolean; entries: number; firstMismatchSeq?: number }>;
}

const instances = new WeakMap<LedgerStore, Ledger>();

export function createLedger(store: LedgerStore): Ledger {
  const existing = instances.get(store);
  if (existing) return existing;

  let tail: Promise<unknown> = Promise.resolve();

  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  const ledger: Ledger = {
    append(input) {
      return serialize(async () => {
        const entries = await store.listLedger();
        const entry = appendLedgerEntry(entries, {
          entryId: input.entryId ?? `led_${randomUUID().slice(0, 8)}`,
          at: input.at,
          actor: input.actor,
          event: input.event,
          ...(input.documentId !== undefined ? { documentId: input.documentId } : {}),
          ...(input.threadKey !== undefined ? { threadKey: input.threadKey } : {}),
          ...(input.details !== undefined ? { details: input.details } : {})
        });
        await store.putLedgerEntry(entry);
        return entry;
      });
    },
    read() {
      return serialize(() => store.listLedger());
    },
    async verify() {
      return verifyLedger(await ledger.read());
    }
  };

  instances.set(store, ledger);
  return ledger;
}
```

- [ ] **Step 4: Run the test, then the full gates**

Run: `npx vitest run test/ledgerLog.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: all pass, 250 prior tests green.

- [ ] **Step 5: Commit**

```bash
git add src/domain/ledgerLog.ts test/ledgerLog.test.ts
git commit -m "feat(domain): add a serialized ledger appender over the store"
```

---

### Task 3: Lifecycle helper and lifecycle-based filters

**Files:**
- Create: `src/domain/lifecycle.ts`
- Modify: `src/storage/fileStore.ts`
- Test: `test/lifecycle.test.ts`
- Test: `test/fileStore.test.ts`

**Interfaces:**
- Consumes: `toDocumentRecord` from `src/domain/correlation.js`; `Item`, `Lifecycle` from `src/domain/model.js`.
- Produces:
  - `lifecycleOf(item: Item): Lifecycle` — reads `item.record.lifecycle`, deriving from `resolvedAt` for legacy items.
  - `withLifecycle(item: Item, lifecycle: Lifecycle, at: string): Item` — returns a copy with the new lifecycle; sets `resolvedAt` to `at` **only when first reaching `closed`**.

- [ ] **Step 1: Write the failing test** — create `test/lifecycle.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { lifecycleOf, withLifecycle } from "../src/domain/lifecycle.js";
import type { Item } from "../src/domain/model.js";

const item = (over: Partial<Item> = {}): Item => ({
  itemId: "itm_a", scanId: "scn_a", class: "bill", confidence: 0.8, readAloudText: "bill",
  fields: {}, proposedActions: [], createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null, ...over
});

describe("lifecycleOf", () => {
  it("derives open for a legacy unresolved item", () => {
    expect(lifecycleOf(item())).toBe("open");
  });
  it("derives closed from a legacy resolvedAt", () => {
    expect(lifecycleOf(item({ resolvedAt: "2026-09-19T11:00:00.000Z" }))).toBe("closed");
  });
  it("reads the stored record when present", () => {
    const record = { lifecycle: "action_taken" as const, confidence: "high" as const, needsRecapture: false, demands: [], threadKey: "t" };
    expect(lifecycleOf(item({ record }))).toBe("action_taken");
  });
});

describe("withLifecycle", () => {
  it("sets resolvedAt exactly when first closing", () => {
    const closed = withLifecycle(item(), "closed", "2026-09-20T12:00:00.000Z");
    expect(closed.resolvedAt).toBe("2026-09-20T12:00:00.000Z");
    expect(closed.record?.lifecycle).toBe("closed");
  });
  it("does not set resolvedAt for a non-closing state", () => {
    expect(withLifecycle(item(), "action_taken", "2026-09-20T12:00:00.000Z").resolvedAt).toBeNull();
  });
  it("preserves an existing resolvedAt", () => {
    const again = withLifecycle(item({ resolvedAt: "2026-01-01T00:00:00.000Z" }), "closed", "2026-09-20T12:00:00.000Z");
    expect(again.resolvedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lifecycle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3a: Implement** — create `src/domain/lifecycle.ts`

```ts
import type { Item, Lifecycle } from "./model.js";
import { toDocumentRecord } from "./correlation.js";

export function lifecycleOf(item: Item): Lifecycle {
  return (item.record ?? toDocumentRecord(item).record).lifecycle;
}

export function withLifecycle(item: Item, lifecycle: Lifecycle, at: string): Item {
  const base = toDocumentRecord(item);
  const firstClose = lifecycle === "closed" && item.resolvedAt === null;
  return {
    ...base,
    resolvedAt: firstClose ? at : item.resolvedAt,
    record: { ...base.record, lifecycle }
  };
}
```

- [ ] **Step 3b: Move the `listItems` filters onto lifecycle** — modify `src/storage/fileStore.ts`

Add the import near the other domain imports:

```ts
import { lifecycleOf } from "../domain/lifecycle.js";
```

Replace the body of `listItems` with:

```ts
    async listItems(filter) {
      const all = readdirSync(itemsDir)
        .map((f) => readValidated<Item>(join(itemsDir, f), ItemSchema))
        .filter((i): i is Item => i !== null);
      if (filter === "all") return all;
      if (filter === "unresolved") return all.filter((i) => {
        const lifecycle = lifecycleOf(i);
        return lifecycle !== "closed" && lifecycle !== "confirmed";
      });
      if (filter === "flagged") return all.filter(isFlagged);
      const today = new Date().toISOString().slice(0, 10);
      return all.filter((i) => {
        const lifecycle = lifecycleOf(i);
        return lifecycle !== "closed" && lifecycle !== "confirmed"
          && i.fields.dueDate !== undefined && i.fields.dueDate <= today;
      });
    },
```

- [ ] **Step 3c: Add the filter tests** — append to `test/fileStore.test.ts`

```ts
describe("lifecycle-based filters", () => {
  it("excludes confirmed and closed records from unresolved", async () => {
    await store.putItem(mkItem({ itemId: "itm_open" }));
    await store.putItem(mkItem({ itemId: "itm_confirmed", record: { lifecycle: "confirmed", confidence: "high", needsRecapture: false, demands: [], threadKey: "t" } }));
    await store.putItem(mkItem({ itemId: "itm_closed", record: { lifecycle: "closed", confidence: "high", needsRecapture: false, demands: [], threadKey: "t" } }));
    expect((await store.listItems("unresolved")).map((i) => i.itemId)).toEqual(["itm_open"]);
  });

  it("excludes confirmed records from due", async () => {
    await store.putItem(mkItem({ itemId: "itm_due", fields: { dueDate: "2020-01-01" } }));
    await store.putItem(mkItem({ itemId: "itm_done", fields: { dueDate: "2020-01-01" }, record: { lifecycle: "confirmed", confidence: "high", needsRecapture: false, demands: [], threadKey: "t" } }));
    expect((await store.listItems("due")).map((i) => i.itemId)).toEqual(["itm_due"]);
  });
});
```

- [ ] **Step 4: Run the tests, then the full gates**

Run: `npx vitest run test/lifecycle.test.ts test/fileStore.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: all pass, existing `resolvedAt`-based filter tests still green (legacy items derive `closed` from `resolvedAt`).

- [ ] **Step 5: Commit**

```bash
git add src/domain/lifecycle.ts src/storage/fileStore.ts test/lifecycle.test.ts test/fileStore.test.ts
git commit -m "feat(domain): make lifecycle authoritative over resolvedAt"
```

---

### Task 4: Deterministic abstention (`assessReadback`)

**Files:**
- Create: `src/domain/readback.ts`
- Test: `test/readback.test.ts`

**Interfaces:**
- Consumes: `ibanIsValid`, `datePlausible`, `amountSane` from `src/domain/validity.js`; `Fields` from `src/domain/model.js`.
- Produces:
  - `interface ReadbackAssessment { confidence: "high" | "low"; needsRecapture: boolean; reasons: string[] }`
  - `assessReadback(input: { text: string; fields: Fields; history?: number[]; now: Date }): ReadbackAssessment` — `low` if any IBAN in `text` fails its checksum, or a present `dueDate` is implausible, or a present `amount` is insane; `reasons` is the de-duplicated list of offending fields.

- [ ] **Step 1: Write the failing test** — create `test/readback.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { assessReadback } from "../src/domain/readback.js";

const now = new Date("2026-09-20T12:00:00.000Z");

describe("assessReadback", () => {
  it("is high for a clean reading", () => {
    const result = assessReadback({
      text: "Amount due: €84.20. Payment due 2026-10-01.",
      fields: { dueDate: "2026-10-01", amount: { currency: "EUR", value: 84.2 } },
      now
    });
    expect(result).toEqual({ confidence: "high", needsRecapture: false, reasons: [] });
  });

  it("flags an IBAN that fails its checksum", () => {
    const result = assessReadback({ text: "Account DE89370400440532013001.", fields: {}, now });
    expect(result.confidence).toBe("low");
    expect(result.reasons).toContain("account");
  });

  it("accepts a valid IBAN", () => {
    expect(assessReadback({ text: "Account DE89370400440532013000.", fields: {}, now }).confidence).toBe("high");
  });

  it("flags an implausible due date", () => {
    expect(assessReadback({ text: "x", fields: { dueDate: "2020-01-01" }, now }).reasons).toContain("dueDate");
  });

  it("flags an amount beyond the historical median", () => {
    const result = assessReadback({ text: "x", fields: { amount: { currency: "EUR", value: 5000 } }, history: [80, 84, 90, 95], now });
    expect(result.reasons).toContain("amount");
  });

  it("requests recapture whenever the reading is low", () => {
    expect(assessReadback({ text: "x", fields: { dueDate: "2020-01-01" }, now }).needsRecapture).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/readback.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/domain/readback.ts`

```ts
import type { Fields } from "./model.js";
import { amountSane, datePlausible, ibanIsValid } from "./validity.js";

export interface ReadbackAssessment {
  confidence: "high" | "low";
  needsRecapture: boolean;
  reasons: string[];
}

const IBAN_CANDIDATE = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/gi;

export function assessReadback(input: {
  text: string;
  fields: Fields;
  history?: number[];
  now: Date;
}): ReadbackAssessment {
  const reasons: string[] = [];

  for (const candidate of input.text.match(IBAN_CANDIDATE) ?? []) {
    if (!ibanIsValid(candidate)) reasons.push("account");
  }
  if (input.fields.dueDate !== undefined && !datePlausible(input.fields.dueDate, input.now)) {
    reasons.push("dueDate");
  }
  if (input.fields.amount !== undefined && !amountSane(input.fields.amount, input.history)) {
    reasons.push("amount");
  }

  const unique = [...new Set(reasons)];
  return {
    confidence: unique.length === 0 ? "high" : "low",
    needsRecapture: unique.length > 0,
    reasons: unique
  };
}
```

- [ ] **Step 4: Run the test, then the full gates**

Run: `npx vitest run test/readback.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/domain/readback.ts test/readback.test.ts
git commit -m "feat(domain): add deterministic readback abstention"
```

---

### Task 5: Capture writes a record and the ledger

**Files:**
- Modify: `src/domain/scans.ts`
- Test: `test/scans.test.ts`

**Interfaces:**
- Consumes: `assessReadback` (Task 4); `toDocumentRecord` (Plan 5); `createLedger` (Task 2); `DocumentState`, `Item`.
- Produces: every `Item` persisted by `processScan` carries a `record` with `threadKey` and demands; `processScan` appends `ingested` then `triaged` per item. A ledger write failure is logged and does **not** fail the scan (the document is already durable).

- [ ] **Step 1: Write the failing test** — append to `test/scans.test.ts`

```ts
describe("processScan records and ledger", () => {
  it("persists a document record and appends ingested then triaged", async () => {
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    await processScan(store, scan.scanId, ["Hello, please look at this letter."]);
    const item = (await store.listItems("all")).find((i) => i.scanId === scan.scanId)!;
    expect(item.record?.lifecycle).toBe("open");
    expect(item.record?.threadKey).toMatch(/^t_/);
    expect((await store.listLedger()).map((e) => e.event)).toEqual(["ingested", "triaged"]);
  });

  it("marks a low-confidence read as awaiting recapture", async () => {
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    await processScan(store, scan.scanId, ["Hello, account DE89370400440532013001."]);
    const item = (await store.listItems("all")).find((i) => i.scanId === scan.scanId)!;
    expect(item.record?.confidence).toBe("low");
    expect(item.record?.needsRecapture).toBe(true);
    expect(item.record?.lifecycle).toBe("awaiting_action");
  });

  it("still marks the scan ready when the ledger cannot be written", async () => {
    const scan = await createScan(store, { imageRefs: ["a"], hint: "mail" });
    const flaky = { ...store, putLedgerEntry: async () => { throw new Error("ledger down"); } } as typeof store;
    const done = await processScan(flaky, scan.scanId, ["Hello there."]);
    expect(done.status).toBe("ready");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/scans.test.ts`
Expected: FAIL — `record` is undefined / `listLedger` has no entries.

- [ ] **Step 3a: Extend imports** — modify `src/domain/scans.ts`

```ts
import { randomUUID } from "node:crypto";
import type { Store } from "../storage/types.js";
import type { DocumentState, Item, Scan } from "./model.js";
import { ItemSchema } from "./model.js";
import { classifyText } from "./classifier.js";
import { extractFields } from "./extractors.js";
import { redactSensitive } from "./redact.js";
import { scoreScam } from "./scam.js";
import { planActions } from "./actionPlanner.js";
import { copy } from "./copy.js";
import { assessReadback } from "./readback.js";
import { toDocumentRecord } from "./correlation.js";
import { createLedger } from "./ledgerLog.js";
```

- [ ] **Step 3b: Build the record inside the analysis loop** — replace the block from `const { class: cls, confidence } = classifyText(...)` through `items.push(...)` with:

```ts
      const { class: cls, confidence } = classifyText(text, signals);
      const fields = extractFields(text, cls);
      const scam = scoreScam(text, signals);
      const itemId = `itm_${randomUUID().slice(0, 8)}`;
      const createdAt = new Date().toISOString();
      const readAloudText = redactSensitive(text);
      const base: Item = {
        itemId, scanId, class: cls, confidence, readAloudText, fields,
        proposedActions: [], createdAt, resolvedAt: null
      };
      const actions = planActions(base, scam);
      const assessment = assessReadback({ text, fields, now: new Date(createdAt) });
      const derived = toDocumentRecord(base).record;
      const record: DocumentState = {
        ...derived,
        lifecycle: assessment.confidence === "low" ? "awaiting_action" : "open",
        confidence: assessment.confidence,
        needsRecapture: assessment.needsRecapture
      };
      items.push(ItemSchema.parse({ ...base, proposedActions: actions, record }));
```

- [ ] **Step 3c: Append the ledger entries after a successful write** — insert between the persist `try/catch` block and `const done: Scan = ...`:

```ts
  const ledger = createLedger(store);
  for (const item of items) {
    const record = item.record;
    if (!record) continue;
    try {
      await ledger.append({
        at: item.createdAt, actor: "agent", event: "ingested",
        documentId: item.itemId, threadKey: record.threadKey,
        details: { class: item.class, confidence: record.confidence }
      });
      await ledger.append({
        at: item.createdAt, actor: "agent", event: "triaged",
        documentId: item.itemId, threadKey: record.threadKey,
        details: { lifecycle: record.lifecycle, needsRecapture: record.needsRecapture }
      });
    } catch (err) {
      console.error(`[scans] ledger append for ${item.itemId} failed:`, err);
    }
  }
```

- [ ] **Step 4: Run the tests, then the full gates**

Run: `npx vitest run test/scans.test.ts test/scanPipeline.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: all pass. Note the flaky-store atomicity tests in `scanPipeline.test.ts` spread the real store, so they still satisfy the widened `Store` interface.

- [ ] **Step 5: Commit**

```bash
git add src/domain/scans.ts test/scans.test.ts
git commit -m "feat(domain): capture produces document records and ledger entries"
```

---

### Task 6: Backlog derivation

**Files:**
- Create: `src/domain/backlog.ts`
- Test: `test/backlog.test.ts`

**Interfaces:**
- Consumes: `buildThreads`, `toDocumentRecord` from `src/domain/correlation.js`; `DocumentRecord`, `Thread` from `src/domain/model.js`; a `Store`.
- Produces:
  - `interface BacklogEntry { thread: Thread; documents: DocumentRecord[]; deadline?: string }`
  - `buildBacklog(store: Store, now: Date): Promise<BacklogEntry[]>` — all threads, each with its records and earliest demand deadline, sorted outstanding-first, then urgency, then oldest first.
  - `describeThread(thread: Thread, deadline?: string): string` — one spoken line for a thread.

- [ ] **Step 1: Write the failing test** — create `test/backlog.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../src/storage/fileStore.js";
import { buildBacklog, describeThread } from "../src/domain/backlog.js";
import type { Item } from "../src/domain/model.js";

const now = new Date("2026-09-20T12:00:00.000Z");

let store: ReturnType<typeof createFileStore>;
beforeEach(() => { store = createFileStore(mkdtempSync(join(tmpdir(), "wf-"))); });

const item = (over: Partial<Item> = {}): Item => ({
  itemId: "itm_a", scanId: "scn_a", class: "bill", confidence: 0.8, readAloudText: "bill",
  fields: { sender: "City Water", reference: "INV-1", dueDate: "2026-09-22" },
  proposedActions: [], createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null, ...over
});

describe("buildBacklog", () => {
  it("returns an empty backlog for a fresh store", async () => {
    expect(await buildBacklog(store, now)).toEqual([]);
  });

  it("ranks an outstanding high-urgency thread first", async () => {
    await store.putItem(item({ itemId: "itm_high" }));
    await store.putItem(item({ itemId: "itm_far", fields: { sender: "Bank", reference: "B-1", dueDate: "2027-06-01" } }));
    const backlog = await buildBacklog(store, now);
    expect(backlog).toHaveLength(2);
    expect(backlog[0]!.thread.urgency).toBe("high");
    expect(backlog[0]!.deadline).toBe("2026-09-22");
  });

  it("does not treat a closed thread as outstanding", async () => {
    await store.putItem(item({ itemId: "itm_closed", resolvedAt: "2026-09-19T11:00:00.000Z" }));
    expect((await buildBacklog(store, now))[0]!.thread.outstanding).toBe(false);
  });
});

describe("describeThread", () => {
  it("names the sender, demand, deadline, and reminders", () => {
    const text = describeThread(
      { threadKey: "t", sender: "City Water", demandType: "payment", documentIds: [], firstSeenAt: "", lastSeenAt: "", reminderCount: 2, urgency: "high", outstanding: true },
      "2026-09-22"
    );
    expect(text).toContain("City Water");
    expect(text).toContain("payment");
    expect(text).toContain("2026-09-22");
    expect(text).toContain("2 reminder(s)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/backlog.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/domain/backlog.ts`

```ts
import type { Store } from "../storage/types.js";
import type { DocumentRecord, Thread } from "./model.js";
import { buildThreads, toDocumentRecord } from "./correlation.js";

export interface BacklogEntry {
  thread: Thread;
  documents: DocumentRecord[];
  deadline?: string;
}

const URGENCY_RANK: Record<Thread["urgency"], number> = { high: 0, medium: 1, low: 2 };

export async function buildBacklog(store: Store, now: Date): Promise<BacklogEntry[]> {
  const records = (await store.listItems("all")).map(toDocumentRecord);
  return buildThreads(records, now)
    .map((thread) => {
      const documents = records.filter((r) => r.record.threadKey === thread.threadKey);
      const deadlines = documents
        .flatMap((d) => d.record.demands)
        .map((d) => d.deadline)
        .filter((d): d is string => typeof d === "string")
        .sort();
      const deadline = deadlines[0];
      return { thread, documents, ...(deadline !== undefined ? { deadline } : {}) };
    })
    .sort(
      (a, b) =>
        Number(b.thread.outstanding) - Number(a.thread.outstanding) ||
        URGENCY_RANK[a.thread.urgency] - URGENCY_RANK[b.thread.urgency] ||
        a.thread.firstSeenAt.localeCompare(b.thread.firstSeenAt)
    );
}

export function describeThread(thread: Thread, deadline?: string): string {
  const who = thread.sender || "an unknown sender";
  const what = thread.demandType === "none" ? "a document" : `a ${thread.demandType}`;
  const when = deadline !== undefined ? ` due ${deadline}` : "";
  const reminders = thread.reminderCount > 0 ? `, ${thread.reminderCount} reminder(s)` : "";
  return `${who}: ${what}${when}${reminders}`;
}
```

- [ ] **Step 4: Run the test, then the full gates**

Run: `npx vitest run test/backlog.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/domain/backlog.ts test/backlog.test.ts
git commit -m "feat(domain): derive an urgency-ranked backlog from the store"
```

---

### Task 7: Authority gate on state change

**Files:**
- Modify: `src/domain/authority.ts`
- Modify: `src/domain/applyAction.ts`
- Test: `test/authority.test.ts`
- Test: `test/authorityGate.test.ts`

**Interfaces:**
- Consumes: `evaluateAuthority`, `DEFAULT_AUTHORITY` (this task); `toDocumentRecord`, `withLifecycle`, `createLedger`.
- Produces:
  - `type AuthorityDecision = "allow" | "confirm" | "refuse" | "escalate"` — `evaluateAuthority` now returns `"escalate"` (not `"refuse"`) for a low-confidence item under the `escalate` policy.
  - `const DEFAULT_AUTHORITY: Authority` — a conservative envelope used when `Preferences.authority` is absent (thresholds `0`, so any amount confirms; no forbidden kinds; `onLowConfidence: "ask"`).
  - `applyAction(store, itemId, actionId, options?: { confirmed?: boolean }): Promise<ApplyResult>` where `ApplyResult` gains `decision: AuthorityDecision`. `refuse`/`escalate` write their ledger event and return without mutating; `confirm` without `confirmed: true` writes `action_proposed` and returns the question; otherwise the action executes, appends `action_confirmed`, and advances lifecycle (`file`/`discard` → `closed`; others → `action_taken`).

- [ ] **Step 1: Update the escalate test** — modify `test/authority.test.ts`

Replace the existing `"refuses with an escalation reason when the policy is escalate"` test with:

```ts
  it("escalates a low-confidence action when the policy is escalate", () => {
    const result = evaluateAuthority({ actionType: "file", record: record("low"), authority: { ...authority, onLowConfidence: "escalate" } });
    expect(result.decision).toBe("escalate");
    expect(result.reason.toLowerCase()).toContain("trusted contact");
  });
```

- [ ] **Step 2: Write the failing gate test** — create `test/authorityGate.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../src/storage/fileStore.js";
import { applyAction } from "../src/domain/applyAction.js";
import type { Authority, Item } from "../src/domain/model.js";

let store: ReturnType<typeof createFileStore>;
beforeEach(() => { store = createFileStore(mkdtempSync(join(tmpdir(), "wf-"))); });

const authority: Authority = {
  autoActUpTo: { currency: "EUR", value: 100 },
  confirmAbove: { currency: "EUR", value: 50 },
  forbidden: ["share_personal_data"],
  onLowConfidence: "ask"
};

const item = (over: Partial<Item> = {}): Item => ({
  itemId: "itm_a", scanId: "scn_a", class: "bill", confidence: 0.8, readAloudText: "bill",
  fields: { dueDate: "2026-10-01", amount: { currency: "EUR", value: 60 } },
  proposedActions: [{ actionId: "itm_a:remind", itemId: "itm_a", type: "remind", params: { on: "2026-10-01" }, status: "proposed" }],
  createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null, ...over
});

async function withAuthority() {
  await store.putPreferences({ ...(await store.getPreferences()), authority });
}

describe("applyAction authority gate", () => {
  it("proposes a confirmation-required action without executing it", async () => {
    await store.putItem(item());
    await withAuthority();
    const result = await applyAction(store, "itm_a", "itm_a:remind");
    expect(result.decision).toBe("confirm");
    expect(result.action.status).toBe("proposed");
    expect(await store.listActions("itm_a")).toHaveLength(0);
    expect((await store.listLedger()).map((e) => e.event)).toContain("action_proposed");
  });

  it("executes a confirmation-required action when confirmed", async () => {
    await store.putItem(item());
    await withAuthority();
    const result = await applyAction(store, "itm_a", "itm_a:remind", { confirmed: true });
    expect(result.decision).toBe("confirm");
    expect(result.action.status).toBe("done");
    expect((await store.listLedger()).map((e) => e.event)).toContain("action_confirmed");
  });

  it("refuses a forbidden action and records it without mutating the item", async () => {
    await store.putItem(item({
      proposedActions: [{ actionId: "itm_a:share", itemId: "itm_a", type: "share", params: {}, status: "proposed" }]
    }));
    await withAuthority();
    const result = await applyAction(store, "itm_a", "itm_a:share");
    expect(result.decision).toBe("refuse");
    expect(result.action.status).toBe("proposed");
    expect((await store.listLedger()).map((e) => e.event)).toContain("action_refused");
  });

  it("escalates a low-confidence item when the policy says so", async () => {
    await store.putItem(item({
      record: { lifecycle: "awaiting_action", confidence: "low", needsRecapture: true, demands: [], threadKey: "t_1" }
    }));
    await store.putPreferences({ ...(await store.getPreferences()), authority: { ...authority, onLowConfidence: "escalate" } });
    const result = await applyAction(store, "itm_a", "itm_a:remind");
    expect(result.decision).toBe("escalate");
    expect((await store.listLedger()).map((e) => e.event)).toContain("escalated");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/authority.test.ts test/authorityGate.test.ts`
Expected: FAIL — `evaluateAuthority` still returns `"refuse"` for escalate; `DEFAULT_AUTHORITY` is not exported; the gate does not exist.

- [ ] **Step 4a: Widen `evaluateAuthority`** — modify `src/domain/authority.ts`

Add the decision type and default envelope after `ActionKind`:

```ts
export type AuthorityDecision = "allow" | "confirm" | "refuse" | "escalate";

export const DEFAULT_AUTHORITY: Authority = {
  autoActUpTo: { currency: "EUR", value: 0 },
  confirmAbove: { currency: "EUR", value: 0 },
  forbidden: [],
  onLowConfidence: "ask"
};
```

Change the return type and the escalate branch:

```ts
export function evaluateAuthority(input: {
  actionType: ActionType;
  amount?: { currency: string; value: number };
  record: DocumentRecord;
  authority: Authority;
}): { decision: AuthorityDecision; reason: string } {
```

```ts
    if (authority.onLowConfidence === "escalate") {
      return { decision: "escalate", reason: copy.authority.lowConfidenceEscalate };
    }
```

- [ ] **Step 4b: Add the gate to `applyAction`** — replace the whole of `src/domain/applyAction.ts` with:

```ts
import type { Store } from "../storage/types.js";
import type { Action, Item } from "./model.js";
import { copy } from "./copy.js";
import { DEFAULT_AUTHORITY, evaluateAuthority, type AuthorityDecision } from "./authority.js";
import { toDocumentRecord } from "./correlation.js";
import { withLifecycle } from "./lifecycle.js";
import { createLedger } from "./ledgerLog.js";

export interface ApplyResult {
  item: Item;
  action: Action;
  message: string;
  decision: AuthorityDecision;
}

export interface ApplyOptions {
  confirmed?: boolean;
}

const CLOSING_ACTIONS: ReadonlySet<Action["type"]> = new Set(["file", "discard"]);

export async function applyAction(
  store: Store,
  itemId: string,
  actionId: string,
  options: ApplyOptions = {}
): Promise<ApplyResult> {
  const item = await store.getItem(itemId);
  if (!item) throw new Error("Unknown item.");
  const action = item.proposedActions.find((a) => a.actionId === actionId);
  if (!action) throw new Error("Unknown action.");

  if (action.status === "done" || action.status === "confirmed") {
    await store.putAction(action);
    return { item, action, message: copy.actions.alreadyDone, decision: "allow" };
  }

  if (action.type === "remind" && typeof action.params.on !== "string") {
    throw new Error("This reminder has no date.");
  }
  if (action.type === "schedule" && typeof action.params.at !== "string") {
    throw new Error("This appointment has no time.");
  }

  const preferences = await store.getPreferences();
  const authority = preferences.authority ?? DEFAULT_AUTHORITY;
  const record = toDocumentRecord(item);
  const verdict = evaluateAuthority({
    actionType: action.type,
    ...(item.fields.amount !== undefined ? { amount: item.fields.amount } : {}),
    record,
    authority
  });

  const ledger = createLedger(store);
  const now = new Date().toISOString();

  if (verdict.decision === "refuse" || verdict.decision === "escalate") {
    await ledger.append({
      at: now,
      actor: "agent",
      event: verdict.decision === "escalate" ? "escalated" : "action_refused",
      documentId: item.itemId,
      threadKey: record.record.threadKey,
      details: { actionType: action.type, reason: verdict.reason }
    });
    return { item, action, message: verdict.reason, decision: verdict.decision };
  }

  if (verdict.decision === "confirm" && options.confirmed !== true) {
    await ledger.append({
      at: now,
      actor: "agent",
      event: "action_proposed",
      documentId: item.itemId,
      threadKey: record.record.threadKey,
      details: { actionType: action.type, reason: verdict.reason }
    });
    return { item, action, message: verdict.reason, decision: "confirm" };
  }

  let message: string;
  switch (action.type) {
    case "remind": message = copy.actions.remind; break;
    case "schedule": message = copy.actions.schedule; break;
    case "flag": message = copy.actions.flag; break;
    case "file": message = copy.actions.file; break;
    case "discard": message = copy.actions.discard; break;
    case "share":
      if (!preferences.trustedContactAlias) throw new Error("No trusted contact is set up.");
      message = copy.actions.share(preferences.trustedContactAlias);
      break;
  }

  const done: Action = { ...action, status: "done" };
  const updatedItem = withLifecycle(
    { ...item, proposedActions: item.proposedActions.map((a) => (a.actionId === action.actionId ? done : a)) },
    CLOSING_ACTIONS.has(action.type) ? "closed" : "action_taken",
    now
  );
  await store.putItem(updatedItem);
  await store.putAction(done);
  await ledger.append({
    at: now,
    actor: "user",
    event: "action_confirmed",
    documentId: item.itemId,
    threadKey: record.record.threadKey,
    details: { actionType: action.type }
  });
  return { item: updatedItem, action: done, message, decision: verdict.decision };
}
```

- [ ] **Step 5: Add the `confirmed` argument to the tool** — modify `src/mcp/server.ts`

Replace the `act_on_item` handler with:

```ts
    async ({ itemId, actionId, confirmed }) => {
      try {
        const result = await applyAction(deps.store, itemId, actionId, { confirmed });
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: { action: result.action, item: result.item, decision: result.decision }
        };
      } catch (err) {
        return safeError("act_on_item", err, copy.toolFailed);
      }
    }
```

and its schema with:

```ts
    { itemId: z.string(), actionId: z.string(), confirmed: z.boolean().default(false) },
```

- [ ] **Step 6: Run the tests, then the full gates**

Run: `npx vitest run test/authority.test.ts test/authorityGate.test.ts test/applyAction.test.ts test/tools.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: all pass. Existing `applyAction.test.ts` items carry no `amount`, so the default envelope allows them and the `resolvedAt` expectations still hold.

- [ ] **Step 7: Commit**

```bash
git add src/domain/authority.ts src/domain/applyAction.ts src/mcp/server.ts test/authority.test.ts test/authorityGate.test.ts
git commit -m "feat(domain): gate every action through the authority envelope"
```

---

### Task 8: Governed tools — backlog, audit, verification, export, briefing

**Files:**
- Modify: `src/domain/copy.ts`
- Modify: `src/mcp/server.ts`
- Test: `test/governedTools.test.ts`
- Test: `test/tools.test.ts`

**Interfaces:**
- Consumes: `buildBacklog`, `describeThread` (Task 6); `createLedger` (Task 2); `verifyLedger`, `buildRecordReport` (Plan 5).
- Produces: MCP tools `get_backlog`, `get_audit`, `verify_ledger`, `export_record`; a reworked `daily_briefing` (still reports the v1 category counts, now led by the most urgent backlog thread); and the `wayfinder://ledger` resource.

- [ ] **Step 1: Write the failing test** — create `test/governedTools.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFileStore } from "../src/storage/fileStore.js";
import { buildServer } from "../src/mcp/server.js";
import { appendLedgerEntry } from "../src/domain/ledger.js";
import { copy } from "../src/domain/copy.js";
import type { Item } from "../src/domain/model.js";

const item = (over: Partial<Item> = {}): Item => ({
  itemId: "itm_a", scanId: "scn_a", class: "bill", confidence: 0.8, readAloudText: "bill",
  fields: { sender: "City Water", reference: "INV-1", dueDate: "2026-09-22" },
  proposedActions: [], createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null, ...over
});

async function connect() {
  const store = createFileStore(mkdtempSync(join(tmpdir(), "wf-")));
  const server = buildServer({ store });
  const client = new Client({ name: "test", version: "0.0.1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, store };
}

const seed = (store: ReturnType<typeof createFileStore>, documentId: string) => {
  const first = appendLedgerEntry([], { entryId: "e1", at: "2026-09-20T12:00:00.000Z", actor: "agent", event: "ingested", documentId });
  const second = appendLedgerEntry([first], { entryId: "e2", at: "2026-09-20T12:01:00.000Z", actor: "agent", event: "triaged", documentId });
  return { first, second };
};

describe("get_backlog", () => {
  it("speaks the most urgent thread and returns the ranked backlog", async () => {
    const { client, store } = await connect();
    await store.putItem(item());
    const res = await client.callTool({ name: "get_backlog", arguments: { date: "2026-09-20" } });
    const sc = res.structuredContent as { backlog: Array<{ thread: { urgency: string; sender: string } }> };
    expect(sc.backlog[0]!.thread.urgency).toBe("high");
    const text = (res.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("City Water");
    await client.close();
  });
});

describe("get_audit", () => {
  it("returns the events for a document", async () => {
    const { client, store } = await connect();
    const { first, second } = seed(store, "itm_a");
    await store.putLedgerEntry(first);
    await store.putLedgerEntry(second);
    const res = await client.callTool({ name: "get_audit", arguments: { documentId: "itm_a" } });
    const sc = res.structuredContent as { entries: Array<{ event: string }> };
    expect(sc.entries.map((e) => e.event)).toEqual(["ingested", "triaged"]);
    await client.close();
  });

  it("says so when there is nothing recorded", async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: "get_audit", arguments: { documentId: "itm_none" } });
    expect((res.content as Array<{ text: string }>)[0]!.text).toBe(copy.audit.empty);
    await client.close();
  });
});

describe("verify_ledger", () => {
  it("reports an intact chain with the terminal hash", async () => {
    const { client, store } = await connect();
    const { first, second } = seed(store, "itm_a");
    await store.putLedgerEntry(first);
    await store.putLedgerEntry(second);
    const res = await client.callTool({ name: "verify_ledger", arguments: {} });
    const sc = res.structuredContent as { ok: boolean; entries: number; terminal: string };
    expect(sc).toEqual({ ok: true, entries: 2, terminal: second.hash });
    expect((res.content as Array<{ text: string }>)[0]!.text).toContain(second.hash);
    await client.close();
  });

  it("reports the first mismatching sequence number", async () => {
    const { client, store } = await connect();
    const { first, second } = seed(store, "itm_a");
    await store.putLedgerEntry(first);
    await store.putLedgerEntry({ ...second, details: { tampered: true } });
    const res = await client.callTool({ name: "verify_ledger", arguments: {} });
    const sc = res.structuredContent as { ok: boolean; firstMismatchSeq?: number };
    expect(sc.ok).toBe(false);
    expect(sc.firstMismatchSeq).toBe(2);
    await client.close();
  });
});

describe("export_record", () => {
  it("produces a report containing the terminal hash", async () => {
    const { client, store } = await connect();
    const { first, second } = seed(store, "itm_a");
    await store.putLedgerEntry(first);
    await store.putLedgerEntry(second);
    const res = await client.callTool({ name: "export_record", arguments: {} });
    const sc = res.structuredContent as { report: string };
    expect(sc.report).toContain("ingested");
    expect(sc.report).toContain(second.hash);
    await client.close();
  });
});

describe("daily_briefing", () => {
  it("leads with the most urgent thread", async () => {
    const { client, store } = await connect();
    await store.putItem(item());
    const res = await client.callTool({ name: "daily_briefing", arguments: { date: "2026-09-20" } });
    expect((res.content as Array<{ text: string }>)[0]!.text).toContain("City Water");
    await client.close();
  });
});

describe("wayfinder://ledger", () => {
  it("is listed and reads back entries with a verification result", async () => {
    const { client, store } = await connect();
    const { first, second } = seed(store, "itm_a");
    await store.putLedgerEntry(first);
    await store.putLedgerEntry(second);
    const list = await client.listResources();
    expect(list.resources.map((r) => r.uri)).toContain("wayfinder://ledger");
    const read = await client.readResource({ uri: "wayfinder://ledger" });
    expect(JSON.stringify(read.contents)).toContain(second.hash);
    await client.close();
  });
});
```

- [ ] **Step 2: Update the resource-list expectation** — modify `test/tools.test.ts`

In the `"lists the app, inbox, and objects resources and reads the inbox"` test, change:

```ts
    expect(list.resources.map((r) => r.uri).sort()).toEqual([APP_RESOURCE_URI, "wayfinder://inbox", "wayfinder://objects"]);
```

to:

```ts
    expect(list.resources.map((r) => r.uri).sort()).toEqual([APP_RESOURCE_URI, "wayfinder://inbox", "wayfinder://ledger", "wayfinder://objects"]);
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/governedTools.test.ts test/tools.test.ts`
Expected: FAIL — the new tools and resource are not registered.

- [ ] **Step 4a: Add the spoken copy** — modify `src/domain/copy.ts`

Add these keys inside the exported `copy` object (after `authority`):

```ts
  backlog: {
    empty: "Nothing is waiting on you right now.",
    summary: (count: number, top: string) => `${count} thing(s) need attention. Most urgent: ${top}.`
  },
  ledger: {
    verified: (entries: number, terminal: string) => `The record has ${entries} entries and the chain is intact. Terminal hash ${terminal}. Nothing has been altered.`,
    tampered: (seq: number) => `The record doesn't verify: entry ${seq} has been changed. I can't prove the record is unaltered.`
  },
  audit: {
    empty: "I have no record of that."
  },
```

- [ ] **Step 4b: Add the imports** — modify `src/mcp/server.ts`

```ts
import { buildBacklog, describeThread, type BacklogEntry } from "../domain/backlog.js";
import { createLedger } from "../domain/ledgerLog.js";
import { buildRecordReport, verifyLedger } from "../domain/ledger.js";
```

- [ ] **Step 4c: Register the new tools** — add after the `get_item` tool in `src/mcp/server.ts`

```ts
  server.tool(
    "get_backlog",
    "Rank what needs attention by urgency, with outstanding demands and related documents.",
    { date: z.string().optional() },
    async ({ date }) => {
      if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return { content: [{ type: "text", text: copy.invalidDate }], isError: true as const };
      }
      let backlog: BacklogEntry[];
      try {
        backlog = await buildBacklog(deps.store, date ? new Date(`${date}T12:00:00.000Z`) : new Date());
      } catch (err) {
        return safeError("get_backlog", err);
      }
      const outstanding = backlog.filter((e) => e.thread.outstanding);
      const text = outstanding.length === 0
        ? copy.backlog.empty
        : copy.backlog.summary(outstanding.length, describeThread(outstanding[0]!.thread, outstanding[0]!.deadline));
      return { content: [{ type: "text", text }], structuredContent: { backlog } };
    }
  );

  server.tool(
    "get_audit",
    "Explain what happened to a document or thread, from the record.",
    { documentId: z.string().optional(), threadKey: z.string().optional() },
    async ({ documentId, threadKey }) => {
      if (documentId === undefined && threadKey === undefined) {
        return { content: [{ type: "text", text: copy.audit.empty }], structuredContent: { entries: [] } };
      }
      let entries: Awaited<ReturnType<ReturnType<typeof createLedger>["read"]>>;
      try {
        entries = (await createLedger(deps.store).read()).filter(
          (e) => (documentId === undefined || e.documentId === documentId)
            && (threadKey === undefined || e.threadKey === threadKey)
        );
      } catch (err) {
        return safeError("get_audit", err);
      }
      const text = entries.length === 0 ? copy.audit.empty : entries.map((e) => e.event).join(", ");
      return { content: [{ type: "text", text }], structuredContent: { entries } };
    }
  );

  server.tool(
    "verify_ledger",
    "Prove the record has not been altered since it was written.",
    {},
    async () => {
      try {
        const entries = await createLedger(deps.store).read();
        const result = verifyLedger(entries);
        const terminal = entries[entries.length - 1]?.hash ?? "0".repeat(64);
        const text = result.ok
          ? copy.ledger.verified(result.entries, terminal)
          : copy.ledger.tampered(result.firstMismatchSeq ?? 1);
        return { content: [{ type: "text", text }], structuredContent: { ...result, terminal } };
      } catch (err) {
        return safeError("verify_ledger", err);
      }
    }
  );

  server.tool(
    "export_record",
    "Produce a voice-friendly report of what the system saw and did, over a period.",
    { from: z.string().optional(), to: z.string().optional() },
    async ({ from, to }) => {
      try {
        const range = {
          ...(from !== undefined ? { from } : {}),
          ...(to !== undefined ? { to } : {})
        };
        const report = buildRecordReport(await createLedger(deps.store).read(), range);
        return { content: [{ type: "text", text: report }], structuredContent: { report } };
      } catch (err) {
        return safeError("export_record", err);
      }
    }
  );
```

- [ ] **Step 4d: Rework `daily_briefing`** — replace the body of its handler in `src/mcp/server.ts`

```ts
    async ({ date }) => {
      if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return { content: [{ type: "text", text: copy.invalidDate }], isError: true as const };
      }
      let due: Item[];
      let appointments: Item[];
      let flagged: Item[];
      let objectReminders: Awaited<ReturnType<Store["listObjects"]>>;
      let backlog: BacklogEntry[];
      try {
        const reference = (date ?? new Date().toISOString()).slice(0, 10);
        const [unresolved, flaggedItems, objects, ranked] = await Promise.all([
          deps.store.listItems("unresolved"),
          deps.store.listItems("flagged"),
          deps.store.listObjects(),
          buildBacklog(deps.store, new Date(`${reference}T12:00:00.000Z`))
        ]);
        due = unresolved.filter((i) => i.fields.dueDate !== undefined && i.fields.dueDate <= reference);
        appointments = unresolved
          .filter((i) => i.class === "appointment" && i.fields.appointmentAt !== undefined)
          .sort((a, b) => a.fields.appointmentAt!.localeCompare(b.fields.appointmentAt!));
        flagged = flaggedItems;
        objectReminders = objects;
        backlog = ranked;
      } catch (err) {
        return safeError("daily_briefing", err);
      }

      const parts: string[] = [];
      if (due.length) parts.push(copy.briefing.due(due.length));
      if (appointments.length) parts.push(copy.briefing.appointments(appointments.length));
      if (flagged.length) parts.push(copy.briefing.flagged(flagged.length));
      if (objectReminders.length) parts.push(copy.briefing.reminders(objectReminders.length));
      const summary = parts.length ? copy.briefing.summary(parts) : copy.briefing.clear;
      const outstanding = backlog.filter((e) => e.thread.outstanding);
      const lead = outstanding.length
        ? `${copy.backlog.summary(outstanding.length, describeThread(outstanding[0]!.thread, outstanding[0]!.deadline))} `
        : "";

      return {
        content: [{ type: "text", text: `${lead}${summary}` }],
        structuredContent: { due, appointments, flagged, objectReminders, backlog }
      };
    }
```

- [ ] **Step 4e: Register the `wayfinder://ledger` resource** — add next to the `objects` resource in `src/mcp/server.ts`

```ts
  server.resource(
    "ledger",
    "wayfinder://ledger",
    { description: "The tamper-evident record of what the system saw and did." },
    async (uri) => {
      const entries = await createLedger(deps.store).read();
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ entries, verification: verifyLedger(entries) })
        }]
      };
    }
  );
```

- [ ] **Step 5: Run the tests, then the full gates**

Run: `npx vitest run test/governedTools.test.ts test/tools.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: all pass, 250 prior tests green.

- [ ] **Step 6: Commit**

```bash
git add src/domain/copy.ts src/mcp/server.ts test/governedTools.test.ts test/tools.test.ts
git commit -m "feat(mcp): expose backlog, audit, verification, and export tools"
```

---

### Task 9: Escalation tool

**Files:**
- Modify: `src/domain/copy.ts`
- Modify: `src/mcp/server.ts`
- Test: `test/governedTools.test.ts`

**Interfaces:**
- Consumes: `withLifecycle` (Task 3); `createLedger` (Task 2).
- Produces: MCP tool `escalate_item(input: { documentId?: string; threadKey?: string; reason?: string })` — requires a trusted contact; records an `escalated` ledger entry and, when given a `documentId`, moves that item to `escalated`.

- [ ] **Step 1: Write the failing test** — append to `test/governedTools.test.ts`

```ts
describe("escalate_item", () => {
  it("records an escalation and moves the document to escalated", async () => {
    const { client, store } = await connect();
    await store.putItem(item({ itemId: "itm_esc" }));
    await store.putPreferences({ ...(await store.getPreferences()), trustedContactAlias: "Priya" });
    const res = await client.callTool({ name: "escalate_item", arguments: { documentId: "itm_esc", reason: "couldn't read it" } });
    expect((res.content as Array<{ text: string }>)[0]!.text).toBe(copy.escalated("Priya"));
    expect((await store.listLedger()).map((e) => e.event)).toContain("escalated");
    expect((await store.getItem("itm_esc"))?.record?.lifecycle).toBe("escalated");
    await client.close();
  });

  it("declines without a trusted contact", async () => {
    const { client, store } = await connect();
    await store.putItem(item({ itemId: "itm_esc" }));
    const res = await client.callTool({ name: "escalate_item", arguments: { documentId: "itm_esc" } });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0]!.text).toBe(copy.noTrustedContact);
    await client.close();
  });

  it("asks for a target when none is given", async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: "escalate_item", arguments: {} });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0]!.text).toBe(copy.escalateTarget);
    await client.close();
  });
});
```

- [ ] **Step 2: Add the copy** — modify `src/domain/copy.ts`

Add after the `audit` key:

```ts
  escalated: (alias: string) => `I've asked ${alias} to help with that.`,
  noTrustedContact: "I don't have a trusted contact set up.",
  escalateTarget: "Tell me which document or thread to escalate.",
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/governedTools.test.ts`
Expected: FAIL — `escalate_item` is not a tool.

- [ ] **Step 4: Implement the tool** — add after `export_record` in `src/mcp/server.ts`

Add the import:

```ts
import { withLifecycle } from "../domain/lifecycle.js";
```

Add the tool:

```ts
  server.tool(
    "escalate_item",
    "Hand an item the customer can't resolve to their trusted contact.",
    { documentId: z.string().optional(), threadKey: z.string().optional(), reason: z.string().optional() },
    async ({ documentId, threadKey, reason }) => {
      if (documentId === undefined && threadKey === undefined) {
        return { content: [{ type: "text", text: copy.escalateTarget }], isError: true as const };
      }
      try {
        const preferences = await deps.store.getPreferences();
        if (!preferences.trustedContactAlias) {
          return { content: [{ type: "text", text: copy.noTrustedContact }], isError: true as const };
        }
        const at = new Date().toISOString();
        if (documentId !== undefined) {
          const item = await deps.store.getItem(documentId);
          if (item) await deps.store.putItem(withLifecycle(item, "escalated", at));
        }
        await createLedger(deps.store).append({
          at,
          actor: "user",
          event: "escalated",
          ...(documentId !== undefined ? { documentId } : {}),
          ...(threadKey !== undefined ? { threadKey } : {}),
          ...(reason !== undefined ? { details: { reason } } : {})
        });
        return {
          content: [{ type: "text", text: copy.escalated(preferences.trustedContactAlias) }],
          structuredContent: { escalated: true }
        };
      } catch (err) {
        return safeError("escalate_item", err);
      }
    }
  );
```

- [ ] **Step 5: Run the tests, then the full gates**

Run: `npx vitest run test/governedTools.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: all pass, 250 prior tests green.

- [ ] **Step 6: Commit**

```bash
git add src/domain/copy.ts src/mcp/server.ts test/governedTools.test.ts
git commit -m "feat(mcp): add escalate_item with recorded escalation"
```

---

## Self-Review

**Spec coverage (Plan 6 scope):**

- §2.1.2 deterministic validity checks surfacing as confidence → Task 4 (`assessReadback`) + Task 5 (wired into capture). §2.1.3 low confidence ⇒ `awaiting_action` + `needsRecapture` + never auto-acted → Task 5 (lifecycle/defaults) and Task 7 (gate refuses/escalates/confirms low-confidence records). Dual-read wiring (§2.1.1) is deliberately deferred — the deterministic checks provide the `low` signal without Bedrock, matching the spec's risk note.
- §2.2.1 append-only hash-chained log persisted → Tasks 1–2; every event entry → Tasks 5 and 7–9. §2.2.4 `verifyLedger` exposed as a tool → Task 8. §2.2.5 `buildRecordReport` exposed as `export_record` → Task 8.
- §2.3.1 envelope persisted in `Preferences.authority` → already present; read in Task 7. §2.3.2 decision before state change → Task 7; `escalate` is now a distinct decision. §2.3.3 refusal is first-class and offers escalation → Task 7 (`action_refused`) + Task 9 (`escalate_item`).
- §3 `lifecycle` authoritative, `resolvedAt` set only at close → Task 3; filters migrated → Task 3. `Item` stays the persisted unit with optional `record` → unchanged.
- §4 correlation/urgency → reused via `toDocumentRecord`/`buildThreads` in Tasks 5–6.
- §5.1 new tools `get_backlog`, `get_audit`, `escalate_item`, `verify_ledger`, `export_record` → Tasks 6, 8, 9. §5.2 changed `act_on_item` (envelope) and `daily_briefing` (backlog-led) → Tasks 7, 8. §5.3 `wayfinder://ledger` resource → Task 8.
- Out of Plan 6 scope by decision: §5.3 screens and `ui` meta (Plan 8), §9 ports / capability disclosure / `wayfinder://capabilities` (Plan 7).

**Placeholder scan:** none — every step carries runnable code or an exact command.

**Type consistency:** `AuthorityDecision` is defined once in `authority.ts` and used by `evaluateAuthority`, `ApplyResult`, and `applyAction`. `BacklogEntry`/`describeThread` are defined in Task 6 and used unchanged in Task 8. `withLifecycle`/`lifecycleOf` are defined in Task 3 and used in Tasks 7 and 9. `createLedger`'s `LedgerStore` is satisfied by the widened `Store` from Task 1; `scans.ts`, `applyAction.ts`, and `server.ts` all obtain their ledger through `createLedger(store)`, so they share one append queue per store. Ledger `details` keep amounts and any monetary figures as **booleans/strings without 7+ digit runs**; the only monetary value written by these paths is the `amount` object on an item, which never enters the ledger.

**Known interactions to watch (accepted):**
- A ledger write failure during capture is logged and does not fail the scan (Task 5), because the document is already durable; the alternative would leave orphan ledger entries or delete a captured document.
- `redactSensitive` masks 7+ digit runs, so any future `details` field carrying an amount must be numeric. Plan 6 writes none.
- `daily_briefing` keeps its v1 category fields for backward compatibility and *adds* the backlog lead plus `backlog` in `structuredContent`; Plan 8's screens can consume it without a breaking change.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-09-20-wayfinder-persistence-tools.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — execute in this session with checkpoints.

Which approach?
