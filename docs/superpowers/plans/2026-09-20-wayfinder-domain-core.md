# Wayfinder v2 — Plan 5: Verifiable Agency Domain Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the pure domain core of Wayfinder v2 — document lifecycle, deterministic validity checks, the tamper-evident ledger, correlation into threads, the authority envelope, and dual-read consensus — with no tool, store, or UI changes.

**Architecture:** Six focused pure modules under `src/domain/`. Nothing here performs I/O; persistence and MCP wiring arrive in Plan 6. The existing persisted unit stays `Item`; v2 state is carried in an **optional** `record` field so items written by earlier versions still parse, and `DocumentRecord` is a normalized view.

**Tech Stack:** TypeScript 5 (ESM), `zod` 3.25, `node:crypto` (SHA-256), `vitest`.

**Spec:** `docs/superpowers/specs/2026-09-20-wayfinder-v2-verifiable-agency.md`

## Global Constraints

- Node **22+**; ESM (`"type": "module"`).
- Domain core is **pure**: no I/O, no network, no model calls, no `Date.now()` inside hashing/decision logic — callers pass `now`.
- `tsconfig` enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Optional properties are **added conditionally**, never assigned `undefined`.
- Account numbers must be masked; `LedgerEntry.details` passes through `redactSensitive` **before hashing**.
- `verifyLedger` returns `{ ok, entries, firstMismatchSeq? }`; terminal hash is the last entry's `hash`.
- IBAN validation is **ISO 7064 mod-97**; EPC checksums are **CRC16-CCITT (0x1021)**.
- All existing 186 tests must stay green; `ItemSchema` changes must be backward compatible.
- Commits use the message given in each task.

---

## File Structure

```
src/domain/model.ts        MODIFY add Lifecycle, Demand, DocumentState, DocumentRecord, LedgerEntry, LedgerEvent, Thread, Authority; Item gains optional `record`
src/domain/validity.ts     CREATE ibanIsValid, datePlausible, amountSane
src/domain/ledger.ts       CREATE canonicalJSON, appendLedgerEntry, verifyLedger, buildRecordReport
src/domain/correlation.ts  CREATE threadKeyFor, isReminderText, isSupersedingText, threadUrgency, buildThreads, toDocumentRecord
src/domain/authority.ts    CREATE evaluateAuthority
src/domain/consensus.ts    CREATE compareReadings
test/validity.test.ts      CREATE
test/ledger.test.ts        CREATE
test/correlation.test.ts   CREATE
test/authority.test.ts     CREATE
test/consensus.test.ts     CREATE
test/model.test.ts         MODIFY extend for the new optional record
```

---

### Task 1: Domain model extensions

**Files:**
- Modify: `src/domain/model.ts`
- Test: `test/model.test.ts`

**Interfaces:**
- Produces: `LifecycleSchema`/`Lifecycle`, `DemandSchema`/`Demand`, `DocumentStateSchema`/`DocumentState`, `DocumentRecord`, `LedgerEventSchema`/`LedgerEvent`, `LedgerEntrySchema`/`LedgerEntry`, `ThreadSchema`/`Thread`, `AuthoritySchema`/`Authority`, and `ItemSchema` with an optional `record`.

- [ ] **Step 1: Write the failing tests** — append to `test/model.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { ItemSchema, LedgerEntrySchema, DocumentStateSchema } from "../src/domain/model.js";

describe("v2 model extensions", () => {
  it("parses a legacy item that has no record field", () => {
    const legacy = {
      itemId: "itm_1", scanId: "scn_1", class: "bill", confidence: 0.8,
      readAloudText: "bill", fields: {}, proposedActions: [],
      createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null
    };
    expect(ItemSchema.parse(legacy).record).toBeUndefined();
  });

  it("parses an item carrying a document state", () => {
    const withRecord = {
      itemId: "itm_1", scanId: "scn_1", class: "bill", confidence: 0.8,
      readAloudText: "bill", fields: {}, proposedActions: [],
      createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null,
      record: {
        lifecycle: "awaiting_action", confidence: "low", needsRecapture: true,
        demands: [{ type: "payment", deadline: "2026-10-01" }], threadKey: "t_123"
      }
    };
    const parsed = ItemSchema.parse(withRecord);
    expect(parsed.record?.lifecycle).toBe("awaiting_action");
    expect(parsed.record?.demands[0]!.type).toBe("payment");
  });

  it("rejects an unknown lifecycle", () => {
    expect(() =>
      DocumentStateSchema.parse({ lifecycle: "zombie", confidence: "high", needsRecapture: false, demands: [], threadKey: "t" })
    ).toThrow();
  });

  it("requires a hash chain link on a ledger entry", () => {
    expect(() => LedgerEntrySchema.parse({ seq: 1, entryId: "e1", at: "2026-09-20T00:00:00.000Z", actor: "agent", event: "ingested", details: {} })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/model.test.ts`
Expected: FAIL — `LedgerEntrySchema` / `DocumentStateSchema` not exported.

- [ ] **Step 3: Implement** — append to `src/domain/model.ts` and extend `ItemSchema`

```ts
export const LifecycleSchema = z.enum(["open", "awaiting_action", "action_taken", "confirmed", "closed", "escalated"]);
export type Lifecycle = z.infer<typeof LifecycleSchema>;

export const DemandSchema = z.object({
  type: z.enum(["payment", "reply", "appointment"]),
  deadline: z.string().optional()
});
export type Demand = z.infer<typeof DemandSchema>;

export const DocumentStateSchema = z.object({
  lifecycle: LifecycleSchema,
  confidence: z.enum(["high", "low"]),
  needsRecapture: z.boolean(),
  demands: z.array(DemandSchema),
  threadKey: z.string(),
  supersedes: z.string().optional(),
  supersededBy: z.string().optional(),
  confirmation: z.object({ at: z.string(), detail: z.string(), artifact: z.string().optional() }).optional()
});
export type DocumentState = z.infer<typeof DocumentStateSchema>;

export const LedgerEventSchema = z.enum([
  "ingested", "triaged", "action_proposed", "action_confirmed", "action_refused",
  "delivery_failed", "superseded", "flag_raised", "escalated", "closed"
]);
export type LedgerEvent = z.infer<typeof LedgerEventSchema>;

export const LedgerEntrySchema = z.object({
  seq: z.number().int().positive(),
  entryId: z.string(),
  at: z.string(),
  actor: z.enum(["agent", "user"]),
  event: LedgerEventSchema,
  documentId: z.string().optional(),
  threadKey: z.string().optional(),
  details: z.record(z.unknown()),
  prevHash: z.string(),
  hash: z.string()
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const ThreadSchema = z.object({
  threadKey: z.string(),
  sender: z.string(),
  demandType: z.string(),
  documentIds: z.array(z.string()),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  reminderCount: z.number().int().nonnegative(),
  urgency: z.enum(["low", "medium", "high"]),
  outstanding: z.boolean()
});
export type Thread = z.infer<typeof ThreadSchema>;

export const AuthoritySchema = z.object({
  autoActUpTo: z.object({ currency: z.string(), value: z.number().nonnegative() }),
  confirmAbove: z.object({ currency: z.string(), value: z.number().nonnegative() }),
  forbidden: z.array(z.enum(["make_payment", "share_personal_data", "delete_document", "discard_document"])),
  onLowConfidence: z.enum(["ask", "refuse", "escalate"])
}).refine((a) => a.confirmAbove.value <= a.autoActUpTo.value, {
  message: "confirmAbove must not exceed autoActUpTo"
});
export type Authority = z.infer<typeof AuthoritySchema>;
```

Then change `ItemSchema` to add, after `resolvedAt`:

```ts
  record: DocumentStateSchema.optional()
```

and after the `Item` type, add the narrowed view:

```ts
export interface DocumentRecord extends Item {
  record: DocumentState;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/model.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: new tests pass and all 186 prior tests stay green (the `record` field is optional).

- [ ] **Step 5: Commit**

```bash
git add src/domain/model.ts test/model.test.ts
git commit -m "feat(domain): add v2 lifecycle, ledger, thread, and authority schemas"
```

---

### Task 2: Deterministic validity checks

**Files:**
- Create: `src/domain/validity.ts`
- Test: `test/validity.test.ts`

**Interfaces:**
- Produces:
  - `ibanIsValid(raw: string): boolean` — ISO 7064 mod-97.
  - `datePlausible(iso: string, now: Date, options?: { pastDays?: number; futureDays?: number }): boolean` — defaults 30 and 730.
  - `amountSane(amount: { value: number; currency: string }, history?: number[]): boolean` — non-negative; if `history` has ≥3 entries, `value <= 20 × median(history)`.

- [ ] **Step 1: Write the failing tests** — create `test/validity.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { ibanIsValid, datePlausible, amountSane } from "../src/domain/validity.js";

const now = new Date("2026-09-20T12:00:00.000Z");

describe("ibanIsValid", () => {
  it("accepts valid IBANs, spaced or not, any case", () => {
    expect(ibanIsValid("DE89370400440532013000")).toBe(true);
    expect(ibanIsValid("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(ibanIsValid("gb29nwbk60161331926819")).toBe(true);
  });

  it("rejects a single-digit OCR misread", () => {
    expect(ibanIsValid("DE89370400440532013001")).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(ibanIsValid("")).toBe(false);
    expect(ibanIsValid("DE89")).toBe(false);
    expect(ibanIsValid("XX00 1234")).toBe(false);
  });
});

describe("datePlausible", () => {
  it("accepts a date inside the window", () => {
    expect(datePlausible("2026-10-01", now)).toBe(true);
  });
  it("rejects a date far in the past or future", () => {
    expect(datePlausible("2020-01-01", now)).toBe(false);
    expect(datePlausible("2035-01-01", now)).toBe(false);
  });
  it("rejects a non-ISO string", () => {
    expect(datePlausible("not-a-date", now)).toBe(false);
  });
});

describe("amountSane", () => {
  it("rejects negative values", () => {
    expect(amountSane({ value: -1, currency: "EUR" })).toBe(false);
  });
  it("accepts a value without history", () => {
    expect(amountSane({ value: 1000000, currency: "EUR" })).toBe(true);
  });
  it("rejects an outlier beyond 20x the median", () => {
    expect(amountSane({ value: 5000, currency: "EUR" }, [80, 84, 90, 95])).toBe(false);
    expect(amountSane({ value: 120, currency: "EUR" }, [80, 84, 90, 95])).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/validity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/domain/validity.ts`

```ts
const IBAN_SHAPE = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;

export function ibanIsValid(raw: string): boolean {
  const clean = raw.replace(/\s+/g, "").toUpperCase();
  if (!IBAN_SHAPE.test(clean)) return false;
  const rearranged = clean.slice(4) + clean.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of numeric) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

export function datePlausible(
  iso: string,
  now: Date,
  options?: { pastDays?: number; futureDays?: number }
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return false;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return false;
  const pastDays = options?.pastDays ?? 30;
  const futureDays = options?.futureDays ?? 730;
  const deltaDays = (parsed.getTime() - now.getTime()) / 86_400_000;
  return deltaDays >= -pastDays && deltaDays <= futureDays;
}

export function amountSane(
  amount: { value: number; currency: string },
  history?: number[]
): boolean {
  if (!Number.isFinite(amount.value) || amount.value < 0) return false;
  if (!history || history.length < 3) return true;
  const sorted = [...history].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  if (median <= 0) return true;
  return amount.value <= median * 20;
}
```

- [ ] **Step 4: Run to verify pass, then gates and commit**

Run: `npx vitest run test/validity.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`

```bash
git add src/domain/validity.ts test/validity.test.ts
git commit -m "feat(domain): add IBAN mod-97, date plausibility, and amount sanity checks"
```

---

### Task 3: Tamper-evident ledger

**Files:**
- Create: `src/domain/ledger.ts`
- Test: `test/ledger.test.ts`

**Interfaces:**
- Consumes: `LedgerEntry`, `LedgerEvent`, `redactSensitive`.
- Produces:
  - `canonicalJSON(value: unknown): string` — keys sorted recursively, no whitespace.
  - `hashEntry(prevHash: string, entry: Omit<LedgerEntry, "hash">): string`.
  - `appendLedgerEntry(entries: LedgerEntry[], input: { entryId: string; at: string; actor: "agent" | "user"; event: LedgerEvent; documentId?: string; threadKey?: string; details?: Record<string, unknown> }): LedgerEntry` — pure; redacts `details`, assigns `seq = entries.length + 1`, links `prevHash` (genesis `"0".repeat(64)`), returns the new entry (does **not** mutate the array).
  - `verifyLedger(entries: LedgerEntry[]): { ok: boolean; entries: number; firstMismatchSeq?: number }`.
  - `buildRecordReport(entries: LedgerEntry[], range: { from?: string; to?: string }): string`.

- [ ] **Step 1: Write the failing tests** — create `test/ledger.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { canonicalJSON, appendLedgerEntry, verifyLedger, buildRecordReport } from "../src/domain/ledger.js";
import type { LedgerEntry } from "../src/domain/model.js";

const base = { entryId: "e", at: "2026-09-20T12:00:00.000Z", actor: "agent" as const };

function chain(): LedgerEntry[] {
  let entries: LedgerEntry[] = [];
  entries = [...entries, appendLedgerEntry(entries, { ...base, entryId: "e1", event: "ingested", documentId: "itm_1", details: { sender: "City Water" } })];
  entries = [...entries, appendLedgerEntry(entries, { ...base, entryId: "e2", event: "triaged", documentId: "itm_1", details: { urgency: "high" } })];
  entries = [...entries, appendLedgerEntry(entries, { ...base, entryId: "e3", event: "action_confirmed", documentId: "itm_1", details: { artifact: "ref-9" } })];
  return entries;
}

describe("canonicalJSON", () => {
  it("sorts keys recursively and emits no whitespace", () => {
    expect(canonicalJSON({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});

describe("appendLedgerEntry", () => {
  it("links each entry to the previous hash and numbers the sequence", () => {
    const entries = chain();
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(entries[0]!.prevHash).toBe("0".repeat(64));
    expect(entries[1]!.prevHash).toBe(entries[0]!.hash);
    expect(entries[2]!.prevHash).toBe(entries[1]!.hash);
  });

  it("redacts sensitive details before hashing", () => {
    const entries = appendLedgerEntry([], { ...base, entryId: "e1", event: "ingested", details: { iban: "DE89370400440532013000" } });
    const [entry] = entries;
    expect(JSON.stringify(entry!.details)).not.toContain("DE89370400440532013000");
  });

  it("does not mutate the input array", () => {
    const entries = chain();
    const before = entries.length;
    appendLedgerEntry(entries, { ...base, entryId: "e4", event: "closed" });
    expect(entries.length).toBe(before);
  });
});

describe("verifyLedger", () => {
  it("verifies an intact chain", () => {
    const result = verifyLedger(chain());
    expect(result).toEqual({ ok: true, entries: 3 });
  });

  it("detects tampering at the altered sequence number", () => {
    const entries = chain();
    entries[1] = { ...entries[1]!, details: { urgency: "low" } };
    expect(verifyLedger(entries)).toEqual({ ok: false, entries: 3, firstMismatchSeq: 2 });
  });

  it("detects a broken link", () => {
    const entries = chain();
    entries[2] = { ...entries[2]!, prevHash: "f".repeat(64) };
    expect(verifyLedger(entries).firstMismatchSeq).toBe(2);
  });

  it("treats an empty ledger as valid", () => {
    expect(verifyLedger([])).toEqual({ ok: true, entries: 0 });
  });
});

describe("buildRecordReport", () => {
  it("includes every event and the terminal hash", () => {
    const entries = chain();
    const report = buildRecordReport(entries, {});
    expect(report).toContain("ingested");
    expect(report).toContain("action_confirmed");
    expect(report).toContain(entries[entries.length - 1]!.hash);
  });

  it("filters by range", () => {
    const entries = chain();
    const report = buildRecordReport(entries, { from: "2026-09-20T12:00:00.000Z", to: "2026-09-20T12:00:00.000Z" });
    expect(report.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/ledger.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/domain/ledger.ts`

```ts
import { createHash } from "node:crypto";
import type { LedgerEntry, LedgerEvent } from "./model.js";
import { redactSensitive } from "./redact.js";

const GENESIS = "0".repeat(64);

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortValue(v)])
    );
  }
  return value;
}

export function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function hashEntry(prevHash: string, entry: Omit<LedgerEntry, "hash">): string {
  return createHash("sha256").update(`${prevHash}\n${canonicalJSON(entry)}`).digest("hex");
}

function redactDetails(details: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    out[key] = typeof value === "string" ? redactSensitive(value) : value;
  }
  return out;
}

export function appendLedgerEntry(
  entries: LedgerEntry[],
  input: {
    entryId: string;
    at: string;
    actor: "agent" | "user";
    event: LedgerEvent;
    documentId?: string;
    threadKey?: string;
    details?: Record<string, unknown>;
  }
): LedgerEntry {
  const prev = entries[entries.length - 1];
  const prevHash = prev ? prev.hash : GENESIS;
  const withoutHash: Omit<LedgerEntry, "hash"> = {
    seq: entries.length + 1,
    entryId: input.entryId,
    at: input.at,
    actor: input.actor,
    event: input.event,
    details: redactDetails(input.details ?? {}),
    prevHash,
    ...(input.documentId !== undefined ? { documentId: input.documentId } : {}),
    ...(input.threadKey !== undefined ? { threadKey: input.threadKey } : {})
  };
  return { ...withoutHash, hash: hashEntry(prevHash, withoutHash) };
}

export function verifyLedger(entries: LedgerEntry[]): { ok: boolean; entries: number; firstMismatchSeq?: number } {
  let prevHash = GENESIS;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    if (entry.seq !== i + 1 || entry.prevHash !== prevHash) {
      return { ok: false, entries: entries.length, firstMismatchSeq: i + 1 };
    }
    const { hash, ...withoutHash } = entry;
    if (hashEntry(prevHash, withoutHash) !== hash) {
      return { ok: false, entries: entries.length, firstMismatchSeq: i + 1 };
    }
    prevHash = hash;
  }
  return { ok: true, entries: entries.length };
}

export function buildRecordReport(entries: LedgerEntry[], range: { from?: string; to?: string }): string {
  const inRange = entries.filter((e) => (!range.from || e.at >= range.from) && (!range.to || e.at <= range.to));
  const lines = inRange.map((e) => {
    const target = e.documentId ?? e.threadKey ?? "";
    return `- ${e.at} ${e.event} ${target} ${canonicalJSON(e.details)}`;
  });
  const terminal = entries[entries.length - 1]?.hash ?? GENESIS;
  return [
    "# Wayfinder record",
    "",
    `Entries: ${inRange.length} of ${entries.length}`,
    ...lines,
    "",
    `Terminal hash: ${terminal}`,
    "Verify: run verify_ledger. This proves the record is internally consistent and unaltered; it is not a legal attestation."
  ].join("\n");
}
```

- [ ] **Step 4: Run to verify pass, then gates and commit**

Run: `npx vitest run test/ledger.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`

```bash
git add src/domain/ledger.ts test/ledger.test.ts
git commit -m "feat(domain): add tamper-evident hash-chained ledger with verification and report"
```

---

### Task 4: Correlation into threads

**Files:**
- Create: `src/domain/correlation.ts`
- Test: `test/correlation.test.ts`

**Interfaces:**
- Consumes: `Fields`, `Item`, `DocumentRecord`, `DocumentState`, `Thread`, `toDocumentRecord` helpers.
- Produces:
  - `demandTypeFor(cls: DocClass): Demand["type"] | null` — `bill → payment`, `appointment → appointment`, `insurance|government|personal → reply`, everything else `null`.
  - `threadKeyFor(fields: Fields, demandType: string): string` — first 12 hex of `sha256(sender + "|" + reference + "|" + demandType)`, dropping an empty reference.
  - `isReminderText(text: string): boolean` and `isSupersedingText(text: string): boolean`.
  - `toDocumentRecord(item: Item): DocumentRecord` — fills defaults for legacy items.
  - `threadUrgency(thread: Pick<Thread, "reminderCount" | "outstanding">, deadline: string | undefined, now: Date): Thread["urgency"]`.
  - `buildThreads(records: DocumentRecord[], now: Date): Thread[]`.

- [ ] **Step 1: Write the failing tests** — create `test/correlation.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  demandTypeFor, threadKeyFor, isReminderText, isSupersedingText, threadUrgency, toDocumentRecord, buildThreads
} from "../src/domain/correlation.js";
import type { Item } from "../src/domain/model.js";

const now = new Date("2026-09-20T12:00:00.000Z");

const item = (over: Partial<Item> = {}): Item => ({
  itemId: "itm_1", scanId: "scn_1", class: "bill", confidence: 0.8, readAloudText: "bill",
  fields: { sender: "City Water", reference: "INV-1", dueDate: "2026-10-01" },
  proposedActions: [], createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null, ...over
});

describe("demandTypeFor", () => {
  it("maps classes to demand types", () => {
    expect(demandTypeFor("bill")).toBe("payment");
    expect(demandTypeFor("appointment")).toBe("appointment");
    expect(demandTypeFor("insurance")).toBe("reply");
    expect(demandTypeFor("junk")).toBeNull();
    expect(demandTypeFor("scam")).toBeNull();
  });
});

describe("threadKeyFor", () => {
  it("is stable for the same sender, reference, and demand type", () => {
    expect(threadKeyFor({ sender: "City Water", reference: "INV-1" }, "payment")).toBe(threadKeyFor({ sender: "City Water", reference: "INV-1" }, "payment"));
  });
  it("differs when the reference differs", () => {
    expect(threadKeyFor({ sender: "City Water", reference: "INV-1" }, "payment")).not.toBe(threadKeyFor({ sender: "City Water", reference: "INV-2" }, "payment"));
  });
  it("falls back to sender + demand type without a reference", () => {
    expect(threadKeyFor({ sender: "City Water" }, "payment")).toBe(threadKeyFor({ sender: "City Water" }, "payment"));
  });
});

describe("text classifiers", () => {
  it("detects reminder and supersession language", () => {
    expect(isReminderText("This is a second reminder")).toBe(true);
    expect(isReminderText("Final notice before action")).toBe(true);
    expect(isReminderText("Your invoice is attached")).toBe(false);
    expect(isSupersedingText("This replaces our earlier letter")).toBe(true);
    expect(isSupersedingText("Correction to your appointment")).toBe(true);
  });
});

describe("toDocumentRecord", () => {
  it("fills defaults for a legacy item", () => {
    const record = toDocumentRecord(item());
    expect(record.record.lifecycle).toBe("open");
    expect(record.record.confidence).toBe("high");
    expect(record.record.demands[0]!.type).toBe("payment");
    expect(record.record.threadKey.length).toBeGreaterThan(0);
  });
  it("derives closed from resolvedAt, and yields no demands for junk", () => {
    expect(toDocumentRecord(item({ resolvedAt: "2026-09-19T11:00:00.000Z" })).record.lifecycle).toBe("closed");
    expect(toDocumentRecord(item({ class: "junk", fields: {} })).record.demands).toHaveLength(0);
  });
});

describe("threadUrgency", () => {
  it("is high inside three days", () => {
    expect(threadUrgency({ reminderCount: 0, outstanding: true }, "2026-09-22", now)).toBe("high");
  });
  it("is high for two or more reminders on an outstanding thread", () => {
    expect(threadUrgency({ reminderCount: 2, outstanding: true }, "2026-12-01", now)).toBe("high");
  });
  it("is medium inside fourteen days", () => {
    expect(threadUrgency({ reminderCount: 0, outstanding: true }, "2026-10-01", now)).toBe("medium");
  });
  it("is low otherwise, and never high once closed", () => {
    expect(threadUrgency({ reminderCount: 0, outstanding: true }, "2027-01-01", now)).toBe("low");
    expect(threadUrgency({ reminderCount: 5, outstanding: false }, "2026-09-21", now)).not.toBe("high");
  });
});

describe("buildThreads", () => {
  it("groups documents, counts reminders, and marks outstanding", () => {
    const a = toDocumentRecord(item({ itemId: "itm_a" }));
    const b = toDocumentRecord(item({ itemId: "itm_b", readAloudText: "Second reminder for your invoice" }));
    const closed = toDocumentRecord(item({ itemId: "itm_c", resolvedAt: "2026-09-19T11:00:00.000Z" }));
    const threads = buildThreads([a, b, closed], now);
    expect(threads).toHaveLength(1);
    const thread = threads[0]!;
    expect(thread.documentIds.sort()).toEqual(["itm_a", "itm_b", "itm_c"]);
    expect(thread.reminderCount).toBe(1);
    expect(thread.outstanding).toBe(true);
    expect(thread.demandType).toBe("payment");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/correlation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/domain/correlation.ts`

```ts
import { createHash } from "node:crypto";
import type { Demand, DocClass, DocumentRecord, Fields, Item, Thread } from "./model.js";

const REMINDER = /\b(reminder|second reminder|third reminder|final notice|overdue)\b/i;
const SUPERSEDING = /\b(replaces|supersedes|correction|updated|revised)\b/i;

export function demandTypeFor(cls: DocClass): Demand["type"] | null {
  if (cls === "bill") return "payment";
  if (cls === "appointment") return "appointment";
  if (cls === "insurance" || cls === "government" || cls === "personal") return "reply";
  return null;
}

export function threadKeyFor(fields: Fields, demandType: string): string {
  const sender = (fields.sender ?? "").trim().toLowerCase();
  const reference = (fields.reference ?? "").trim().toLowerCase();
  const parts = reference ? [sender, reference, demandType] : [sender, demandType];
  return `t_${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 12)}`;
}

export function isReminderText(text: string): boolean {
  return REMINDER.test(text);
}

export function isSupersedingText(text: string): boolean {
  return SUPERSEDING.test(text);
}

export function toDocumentRecord(item: Item): DocumentRecord {
  if (item.record) return item as DocumentRecord;
  const type = demandTypeFor(item.class);
  const deadline = item.fields.dueDate ?? item.fields.appointmentAt;
  const demands: Demand[] = type ? [{ type, ...(deadline ? { deadline } : {}) }] : [];
  const threadKey = threadKeyFor(item.fields, type ?? "none");
  return {
    ...item,
    record: {
      lifecycle: item.resolvedAt ? "closed" : "open",
      confidence: "high",
      needsRecapture: false,
      demands,
      threadKey
    }
  };
}

export function threadUrgency(
  thread: Pick<Thread, "reminderCount" | "outstanding">,
  deadline: string | undefined,
  now: Date
): Thread["urgency"] {
  if (!thread.outstanding) return "low";
  if (deadline) {
    const days = (new Date(deadline).getTime() - now.getTime()) / 86_400_000;
    if (days <= 3) return "high";
    if (days <= 14) return "medium";
  }
  if (thread.reminderCount >= 2) return "high";
  return "low";
}

export function buildThreads(records: DocumentRecord[], now: Date): Thread[] {
  const grouped = new Map<string, DocumentRecord[]>();
  for (const record of records) {
    const list = grouped.get(record.record.threadKey) ?? [];
    list.push(record);
    grouped.set(record.record.threadKey, list);
  }

  return [...grouped.entries()].map(([threadKey, docs]) => {
    const sorted = [...docs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const demand = docs.find((d) => d.record.demands[0])?.record.demands[0];
    const deadline = docs
      .flatMap((d) => d.record.demands)
      .map((d) => d.deadline)
      .filter((d): d is string => typeof d === "string")
      .sort()[0];
    const reminderCount = docs.filter((d) => isReminderText(d.readAloudText)).length;
    const outstanding = docs.some((d) => d.record.lifecycle !== "closed" && d.record.lifecycle !== "confirmed");
    const urgency = threadUrgency({ reminderCount, outstanding }, deadline, now);
    return {
      threadKey,
      sender: docs.find((d) => d.fields.sender)?.fields.sender ?? "",
      demandType: demand?.type ?? "none",
      documentIds: sorted.map((d) => d.itemId),
      firstSeenAt: sorted[0]!.createdAt,
      lastSeenAt: sorted[sorted.length - 1]!.createdAt,
      reminderCount,
      urgency,
      outstanding
    };
  });
}
```

- [ ] **Step 4: Run to verify pass, then gates and commit**

Run: `npx vitest run test/correlation.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`

```bash
git add src/domain/correlation.ts test/correlation.test.ts
git commit -m "feat(domain): add deterministic document correlation and thread urgency"
```

---

### Task 5: Authority envelope

**Files:**
- Create: `src/domain/authority.ts`
- Test: `test/authority.test.ts`

**Interfaces:**
- Consumes: `Authority`, `ActionType`, `DocumentRecord`.
- Produces:
  - `ActionKind = "make_payment" | "share_personal_data" | "delete_document" | "discard_document" | "other"`.
  - `kindFor(actionType: ActionType): ActionKind`.
  - `evaluateAuthority(input: { actionType: ActionType; amount?: { currency: string; value: number }; record: DocumentRecord; authority: Authority }): { decision: "allow" | "confirm" | "refuse"; reason: string }`.

**Decision order (exact):**
1. `record.record.confidence === "low"` → apply `authority.onLowConfidence` (`ask` → `confirm`, `refuse` → `refuse`, `escalate` → `refuse` with an escalation reason).
2. `kindFor(actionType)` is in `authority.forbidden` → `refuse`.
3. `amount` present and `amount.value >= confirmAbove.value` or `amount.value > autoActUpTo.value` → `confirm`.
4. Otherwise → `allow`.

- [ ] **Step 1: Write the failing tests** — create `test/authority.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { kindFor, evaluateAuthority } from "../src/domain/authority.js";
import type { Authority, DocumentRecord } from "../src/domain/model.js";

const authority: Authority = {
  autoActUpTo: { currency: "EUR", value: 100 },
  confirmAbove: { currency: "EUR", value: 50 },
  forbidden: ["share_personal_data", "delete_document"],
  onLowConfidence: "ask"
};

const record = (confidence: "high" | "low" = "high"): DocumentRecord => ({
  itemId: "itm_1", scanId: "scn_1", class: "bill", confidence: 0.9, readAloudText: "bill",
  fields: {}, proposedActions: [], createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null,
  record: { lifecycle: "awaiting_action", confidence, needsRecapture: false, demands: [], threadKey: "t_1" }
});

describe("kindFor", () => {
  it("maps action types to policy kinds", () => {
    expect(kindFor("remind")).toBe("other");
    expect(kindFor("share")).toBe("share_personal_data");
    expect(kindFor("discard")).toBe("discard_document");
  });
});

describe("evaluateAuthority", () => {
  it("allows a small amount under both thresholds", () => {
    expect(evaluateAuthority({ actionType: "remind", amount: { currency: "EUR", value: 20 }, record: record(), authority }).decision).toBe("allow");
  });
  it("confirms an amount above the confirmation floor", () => {
    expect(evaluateAuthority({ actionType: "remind", amount: { currency: "EUR", value: 60 }, record: record(), authority }).decision).toBe("confirm");
  });
  it("confirms an amount above the auto-action ceiling", () => {
    expect(evaluateAuthority({ actionType: "remind", amount: { currency: "EUR", value: 500 }, record: record(), authority }).decision).toBe("confirm");
  });
  it("refuses a forbidden action regardless of amount", () => {
    const result = evaluateAuthority({ actionType: "share", amount: { currency: "EUR", value: 1 }, record: record(), authority });
    expect(result.decision).toBe("refuse");
    expect(result.reason.length).toBeGreaterThan(0);
  });
  it("confirms a low-confidence action when the policy is ask", () => {
    expect(evaluateAuthority({ actionType: "file", record: record("low"), authority }).decision).toBe("confirm");
  });
  it("refuses a low-confidence action when the policy is refuse", () => {
    expect(evaluateAuthority({ actionType: "file", record: record("low"), authority: { ...authority, onLowConfidence: "refuse" } }).decision).toBe("refuse");
  });
  it("refuses with an escalation reason when the policy is escalate", () => {
    const result = evaluateAuthority({ actionType: "file", record: record("low"), authority: { ...authority, onLowConfidence: "escalate" } });
    expect(result.decision).toBe("refuse");
    expect(result.reason.toLowerCase()).toContain("trusted contact");
  });
  it("allows a high-confidence non-forbidden action with no amount", () => {
    expect(evaluateAuthority({ actionType: "file", record: record(), authority }).decision).toBe("allow");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/authority.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/domain/authority.ts`

```ts
import type { ActionType, Authority, DocumentRecord } from "./model.js";

export type ActionKind =
  | "make_payment" | "share_personal_data" | "delete_document" | "discard_document" | "other";

export function kindFor(actionType: ActionType): ActionKind {
  switch (actionType) {
    case "share": return "share_personal_data";
    case "discard": return "discard_document";
    default: return "other";
  }
}

export function evaluateAuthority(input: {
  actionType: ActionType;
  amount?: { currency: string; value: number };
  record: DocumentRecord;
  authority: Authority;
}): { decision: "allow" | "confirm" | "refuse"; reason: string } {
  const { actionType, amount, record, authority } = input;

  if (record.record.confidence === "low") {
    if (authority.onLowConfidence === "refuse") {
      return { decision: "refuse", reason: "I can't read this reliably, so I won't act on it." };
    }
    if (authority.onLowConfidence === "escalate") {
      return { decision: "refuse", reason: "I can't read this reliably; I'll ask your trusted contact to help." };
    }
    return { decision: "confirm", reason: "I'm not certain I read this correctly — please confirm." };
  }

  const kind = kindFor(actionType);
  if (kind !== "other" && authority.forbidden.includes(kind)) {
    return { decision: "refuse", reason: `You have not allowed me to ${kind.replace(/_/g, " ")}.` };
  }

  if (amount) {
    if (amount.value >= authority.confirmAbove.value || amount.value > authority.autoActUpTo.value) {
      return { decision: "confirm", reason: "This is above the amount I can act on without asking." };
    }
  }

  return { decision: "allow", reason: "" };
}
```

- [ ] **Step 4: Run to verify pass, then gates and commit**

Run: `npx vitest run test/authority.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`

```bash
git add src/domain/authority.ts test/authority.test.ts
git commit -m "feat(domain): add scoped authority envelope with refusal reasons"
```

---

### Task 6: Dual-read consensus

**Files:**
- Create: `src/domain/consensus.ts`
- Test: `test/consensus.test.ts`

**Interfaces:**
- Consumes: `Fields`.
- Produces:
  - `CRITICAL_FIELDS = ["sender", "dueDate", "reference", "maskedAccount"] as const`.
  - `compareReadings(a: Partial<Fields> & { amount?: { value: number; currency: string } }, b: Partial<Fields> & { amount?: { value: number; currency: string } }): { confidence: "high" | "low"; disagreements: string[] }`.

**Agreement rule (exact):** for each of `sender`, `dueDate`, `reference`, `maskedAccount`, and `amount.value`, compare only when **at least one** side has a value; if one side has a value and the other does not, or both have values that differ, that field is a disagreement. Both absent is agreement. Any disagreement ⇒ `low`.

- [ ] **Step 1: Write the failing tests** — create `test/consensus.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { compareReadings } from "../src/domain/consensus.js";

describe("compareReadings", () => {
  it("agrees when both reads match", () => {
    const a = { sender: "City Water", dueDate: "2026-10-01", amount: { value: 84.2, currency: "EUR" } };
    const b = { sender: "City Water", dueDate: "2026-10-01", amount: { value: 84.2, currency: "EUR" } };
    expect(compareReadings(a, b)).toEqual({ confidence: "high", disagreements: [] });
  });

  it("flags a differing amount", () => {
    const result = compareReadings({ amount: { value: 84.2, currency: "EUR" } }, { amount: { value: 842, currency: "EUR" } });
    expect(result.confidence).toBe("low");
    expect(result.disagreements).toContain("amount.value");
  });

  it("flags a field present on only one side", () => {
    const result = compareReadings({ reference: "INV-1" }, {});
    expect(result.confidence).toBe("low");
    expect(result.disagreements).toContain("reference");
  });

  it("treats both-absent as agreement", () => {
    expect(compareReadings({}, {})).toEqual({ confidence: "high", disagreements: [] });
  });

  it("collects multiple disagreements", () => {
    const result = compareReadings({ sender: "A", dueDate: "2026-10-01" }, { sender: "B", dueDate: "2026-11-01" });
    expect(result.disagreements.sort()).toEqual(["dueDate", "sender"]);
  });

  it("ignores case and collapses whitespace when comparing text fields", () => {
    expect(compareReadings({ reference: "INV-1" }, { reference: "inv-1" }).confidence).toBe("high");
    expect(compareReadings({ sender: "City   Water" }, { sender: "city water" }).confidence).toBe("high");
    expect(compareReadings({ sender: "City Water" }, { sender: "city waters" }).confidence).toBe("low");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/consensus.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/domain/consensus.ts`

```ts
import type { Fields } from "./model.js";

export const CRITICAL_FIELDS = ["sender", "dueDate", "reference", "maskedAccount"] as const;

type Reading = Partial<Fields> & { amount?: { value: number; currency: string } };

function normalize(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.toLowerCase().replace(/\s+/g, " ") : undefined;
  }
  return String(value);
}

export function compareReadings(a: Reading, b: Reading): { confidence: "high" | "low"; disagreements: string[] } {
  const disagreements: string[] = [];

  const pairs: Array<[string, unknown, unknown]> = [
    ...CRITICAL_FIELDS.map((field) => [field, a[field], b[field]] as [string, unknown, unknown]),
    ["amount.value", a.amount?.value, b.amount?.value]
  ];

  for (const [name, left, right] of pairs) {
    const l = normalize(left);
    const r = normalize(right);
    if (l === undefined && r === undefined) continue;
    if (l !== r) disagreements.push(name);
  }

  return { confidence: disagreements.length === 0 ? "high" : "low", disagreements };
}
```

- [ ] **Step 4: Run to verify pass, then the full gates and commit**

Run: `npx vitest run test/consensus.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`

```bash
git add src/domain/consensus.ts test/consensus.test.ts
git commit -m "feat(domain): add dual-read consensus over critical fields"
```

---

## Self-Review

**Spec coverage (Plan 5 scope):** §3 lifecycle/DocumentRecord/LedgerEntry/Thread/Authority → T1; §2.1 IBAN mod-97, date plausibility, amount sanity → T2; §2.2 hash-chained ledger, verification, report, redaction-before-hashing → T3; §4 all five correlation rules plus `toDocumentRecord` → T4; §2.3 envelope and decision order → T5; §2.1 dual-read field consensus → T6. §9 ports, §5 tool changes, §12 screens, persistence, and the scan worker's dual-read wiring are **Plan 6/7/8**, not this plan.

**Placeholder scan:** none — every step carries real, runnable code.

**Type consistency:** `DocumentState`/`DocumentRecord`/`LedgerEntry`/`Thread`/`Authority` are defined in T1 and used unchanged in T3–T6. `demandTypeFor` returns `Demand["type"] | null` and `toDocumentRecord` handles the `null` case. `Authority` is `zod`-refined (`confirmAbove ≤ autoActUpTo`) and T5's test data satisfies that (`50 ≤ 100`). `compareReadings` returns `disagreements` as the literal field names asserted in T4's ledger details and in T6's tests.

**Known interaction to watch:** `redactSensitive` masks 7+ digit runs, so an `amount` stored as a string inside ledger `details` could be masked. T3 stores amounts as numbers, which are not strings and are therefore untouched. Plan 6 must keep that convention when writing `action_*` entries.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-09-20-wayfinder-domain-core.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — execute in this session with checkpoints.

Which approach?
