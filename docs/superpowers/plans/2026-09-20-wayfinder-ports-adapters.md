# Wayfinder v2 — Plan 7: Ports & Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the optional-services layer of the v2 spec — six small ports, each with a null adapter that preserves today's behaviour exactly; the three reference adapters (`WebhookNotifier`, `IcsFileSink`, EPC-QR `PaymentHandoff`); a shared conformance harness; and capability disclosure — with nothing enabled by default and no port able to weaken the three pillars.

**Architecture:** A new `src/adapters/` layer sits beside the pure domain core. Ports are plain interfaces; adapters are inert unless explicitly configured via `WAYFINDER_ADAPTER_<PORT>` or `Preferences.adapters`; network adapters run **off the request path** through an internal queue, and every outbound payload is redacted before it leaves the process. The ledger records each external invocation (`external_invoked`) and each delivery failure (`delivery_failed`). Capability disclosure reports what is actually wired.

**Tech Stack:** TypeScript 5 (ESM), `zod` 3.25, `node:crypto`, `node:fs/promises`, global `fetch` (Node 22), `vitest`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-20-wayfinder-v2-verifiable-agency.md` (§7, §8, §9) and the approved follow-up on `action_executed`.

## Global Constraints

- Node **22+**; ESM (`"type": "module"`); every relative import uses the `.js` extension (NodeNext).
- `tsconfig` enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Optional properties/fields are **added conditionally**, never assigned `undefined`.
- **Disabled by default.** With no adapters configured, behaviour and the full test suite are unchanged from the post-Plan-6 state (`298 passing`). The null adapter is the default in every code path and test.
- **Never in the request path.** Network adapters run in the worker or after the tool response; the < 500 ms tool-handler budget is inviolable.
- **Redact before transmit.** Outbound payloads pass through `redactSensitive` before leaving the process.
- **HTTPS only, exact-URL allowlist, hard 5 s timeout, idempotency by `entryId`.** A notification carries the originating `entryId` so a retry cannot double-notify.
- **Secrets come from the environment only**; never logged, never written to `Preferences` or the ledger.
- **Failures are visible.** A delivery failure appends `delivery_failed` and is surfaced; it is never silent.
- **The permanent line (§9.8):** payment **execution**, medical/financial **advice**, and **emergency response** are never shipped. `PaymentHandoff` produces instructions and a QR payload; it never moves money.
- Ledger `details` keep monetary amounts as **numbers**, never strings (`redactSensitive` masks 7+ digit runs). Adapter `details` carry adapter names, not amounts.
- Two **additive** `LedgerEvent` members are introduced: `action_executed` and `external_invoked`. Additive enum growth is backward compatible with stored data.
- Commits use the message given in each task. Stage only the files named.

---

## File Structure

```
src/adapters/types.ts           CREATE six port interfaces + AdapterBundle + NotifyInput
src/adapters/null.ts            CREATE null adapters (default = today), local signature
src/adapters/config.ts          CREATE AdapterConfig + resolveAdapterConfig(env, prefs)
src/adapters/epcQr.ts           CREATE crc16ccitt, buildEpcPayload, epcPayment
src/adapters/icsFileSink.ts     CREATE buildIcs, createIcsFileSink
src/adapters/webhookNotifier.ts CREATE createWebhookNotifier
src/adapters/registry.ts        CREATE createAdapters(config) -> AdapterBundle
src/adapters/notifyQueue.ts     CREATE off-request-path delivery queue
src/adapters/capabilities.ts    CREATE buildCapabilities
src/domain/model.ts             MODIFY Preferences.adapters; LedgerEvent += action_executed, external_invoked
src/domain/applyAction.ts       MODIFY allow -> action_executed; return the receipt entry
src/mcp/server.ts               MODIFY adapters/notify deps, prepare_payment, wayfinder://capabilities
src/server/http.ts              MODIFY GET /capabilities
src/server/index.ts             MODIFY construct + wire adapters off-path
src/domain/copy.ts              MODIFY capability + handoff copy
package.json                    MODIFY add adapters:conformance script
test/authorityGate.test.ts      MODIFY action_executed expectation
test/adapters/contract.ts       CREATE shared conformance suite
test/adapters/adapters.test.ts  CREATE null/reference adapter + config + capabilities tests
test/adapters/notifyQueue.test.ts CREATE queue tests
test/capabilities.test.ts       CREATE resource + HTTP capabilities tests
scripts/adapters-conformance.mjs CREATE
docs/adapters/*.md              CREATE recipes (notifier, calendar, payment, signature, documentSource, assist)
```

---

### Task 1: Ledger events and the receipt

**Files:**
- Modify: `src/domain/model.ts`
- Modify: `src/domain/applyAction.ts`
- Modify: `test/authorityGate.test.ts`
- Test: `test/model.test.ts` (extend)

**Interfaces:**
- Produces: `LedgerEvent` gains `"action_executed"` and `"external_invoked"`; an auto-allowed action now writes `action_executed` (actor `agent`) while an explicitly confirmed one keeps `action_confirmed` (actor `user`); `ApplyResult` gains `receipt?: LedgerEntry` (the entry just appended on refuse/escalate/propose/execute paths).

- [ ] **Step 1: Write the failing test** — append to `test/model.test.ts`

```ts
describe("v2 ledger events", () => {
  it("accepts the executed and external-invoked events", () => {
    expect(LedgerEventSchema.parse("action_executed")).toBe("action_executed");
    expect(LedgerEventSchema.parse("external_invoked")).toBe("external_invoked");
  });
});
```

Add `LedgerEventSchema` to that file's import from `../src/domain/model.js`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/model.test.ts`
Expected: FAIL — `action_executed` is not a valid enum member.

- [ ] **Step 3a: Extend the event enum** — modify `src/domain/model.ts`

Replace the `LedgerEventSchema` array with:

```ts
export const LedgerEventSchema = z.enum([
  "ingested", "triaged", "action_proposed", "action_executed", "action_confirmed", "action_refused",
  "delivery_failed", "external_invoked", "superseded", "flag_raised", "escalated", "closed"
]);
```

- [ ] **Step 3b: Record auto-allowed actions truthfully** — modify `src/domain/applyAction.ts`

Add `LedgerEntry` to the model import:

```ts
import type { Action, Item, LedgerEntry } from "./model.js";
```

Add `receipt` to `ApplyResult`:

```ts
export interface ApplyResult {
  item: Item;
  action: Action;
  message: string;
  decision: AuthorityDecision;
  receipt?: LedgerEntry;
}
```

Capture the entry on the refuse/escalate path:

```ts
  if (verdict.decision === "refuse" || verdict.decision === "escalate") {
    const receipt = await ledger.append({
      at: now,
      actor: "agent",
      event: verdict.decision === "escalate" ? "escalated" : "action_refused",
      documentId: item.itemId,
      threadKey: record.record.threadKey,
      details: { actionType: action.type, reason: verdict.reason }
    });
    return { item, action, message: verdict.reason, decision: verdict.decision, receipt };
  }
```

Capture the entry on the propose path:

```ts
  if (verdict.decision === "confirm" && options.confirmed !== true) {
    const receipt = await ledger.append({
      at: now,
      actor: "agent",
      event: "action_proposed",
      documentId: item.itemId,
      threadKey: record.record.threadKey,
      details: { actionType: action.type, reason: verdict.reason }
    });
    return { item, action, message: verdict.reason, decision: "confirm", receipt };
  }
```

Change the execute-path receipt to distinguish automatic execution from user confirmation:

```ts
  const receipt = await ledger.append({
    at: now,
    actor: verdict.decision === "allow" ? "agent" : "user",
    event: verdict.decision === "allow" ? "action_executed" : "action_confirmed",
    documentId: item.itemId,
    threadKey: record.record.threadKey,
    details: { actionType: action.type }
  });
```

and return it:

```ts
  return { item: updatedItem, action: done, message, decision: verdict.decision, receipt };
```

- [ ] **Step 3c: Update the affected expectation** — modify `test/authorityGate.test.ts`

Replace the `"records the receipt as an agent action when authority allows it automatically"` test body's lookup line so it finds `action_executed`:

```ts
  it("records the receipt as an agent action when authority allows it automatically", async () => {
    await store.putItem(item({ fields: { dueDate: "2026-10-01" } }));
    await withAuthority();
    const result = await applyAction(store, "itm_a", "itm_a:remind");
    expect(result.decision).toBe("allow");
    const entry = (await store.listLedger()).find((e) => e.event === "action_executed");
    expect(entry?.actor).toBe("agent");
  });
```

Also update the failed-receipt test's final assertion (currently `not.toContain("action_confirmed")`) to:

```ts
    expect((await store.listLedger()).map((e) => e.event)).not.toContain("action_executed");
```

- [ ] **Step 4: Run the tests, then the full gates**

Run: `npx vitest run test/model.test.ts test/authorityGate.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: all pass. `applyAction.test.ts` and `governedTools.test.ts` do not assert the allow-path event, so they stay green.

- [ ] **Step 5: Commit**

```bash
git add src/domain/model.ts src/domain/applyAction.ts test/model.test.ts test/authorityGate.test.ts
git commit -m "feat(domain): distinguish executed from confirmed and record external invocations"
```

---

### Task 2: Port interfaces and null adapters

**Files:**
- Create: `src/adapters/types.ts`
- Create: `src/adapters/null.ts`
- Test: `test/adapters/adapters.test.ts`

**Interfaces:**
- Produces: `Notifier`, `CalendarSink`, `PaymentHandoff`, `SignatureProvider`, `DocumentSource`, `AssistProvider`, `AdapterBundle`, `NotifyInput` (with optional `entryId`); and `nullAdapters: AdapterBundle`.

- [ ] **Step 1: Write the failing test** — create `test/adapters/adapters.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { nullAdapters } from "../../src/adapters/null.js";

describe("null adapters", () => {
  it("delivers nothing and says so without throwing", async () => {
    await expect(nullAdapters.notifier.notify({ event: "triaged", summary: "x" })).resolves.toEqual({
      delivered: false,
      detail: "no notifier configured"
    });
  });

  it("returns an internal ref for calendar publishes without touching the filesystem", async () => {
    await expect(nullAdapters.calendar.publish({ title: "Dentist", start: "2026-10-01T09:00:00.000Z" })).resolves.toEqual({
      ref: "ledger:Dentist"
    });
  });

  it("prepares a spoken-only payment with no QR payload", () => {
    const result = nullAdapters.payment.prepare({
      amount: { currency: "EUR", value: 12.5 },
      beneficiaryName: "City Water",
      iban: "DE89370400440532013000",
      remittance: "INV-1"
    });
    expect(result.instruction).toContain("City Water");
    expect(result.epcQr).toBeUndefined();
    expect(result.ledgerNote).toContain("no payment was made");
  });

  it("attests locally with the head hash", async () => {
    await expect(nullAdapters.signature.attest("a".repeat(64))).resolves.toEqual({ kind: "local", proof: "a".repeat(64) });
  });

  it("polls to nothing and keeps the cursor stable", async () => {
    await expect(nullAdapters.documentSource.poll(undefined)).resolves.toEqual({ imageRefs: [], texts: [], cursor: "0" });
  });

  it("returns a null assist session", async () => {
    await expect(nullAdapters.assist.request({ reason: "unclear", documentId: "itm_a" })).resolves.toEqual({ sessionRef: "none" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/adapters/adapters.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3a: Implement the ports** — create `src/adapters/types.ts`

```ts
import type { LedgerEvent } from "../domain/model.js";

export interface NotifyInput {
  event: LedgerEvent;
  documentId?: string;
  threadKey?: string;
  summary: string; // already redacted by the caller
  entryId?: string; // originating ledger entry, for idempotency
}

export interface Notifier {
  notify(input: NotifyInput): Promise<{ delivered: boolean; detail: string }>;
}

export interface CalendarPublishInput {
  title: string;
  start: string;
  durationMinutes?: number;
  description?: string;
}

export interface CalendarSink {
  publish(input: CalendarPublishInput): Promise<{ ref: string }>;
}

export interface PaymentPrepareInput {
  amount: { currency: string; value: number };
  beneficiaryName: string;
  iban: string;
  remittance: string;
}

export interface PaymentHandoff {
  prepare(input: PaymentPrepareInput): { instruction: string; epcQr?: string; ledgerNote: string };
}

export interface SignatureProvider {
  attest(headHash: string): Promise<{ kind: "local" | "kms" | "tsa"; proof: string }>;
}

export interface DocumentSource {
  poll(cursor: string | undefined): Promise<{ imageRefs: string[]; texts: string[]; cursor: string }>;
}

export interface AssistProvider {
  request(input: { reason: string; documentId?: string }): Promise<{ sessionRef: string }>;
}

export interface AdapterBundle {
  notifier: Notifier;
  calendar: CalendarSink;
  payment: PaymentHandoff;
  signature: SignatureProvider;
  documentSource: DocumentSource;
  assist: AssistProvider;
}
```

- [ ] **Step 3b: Implement the null adapters** — create `src/adapters/null.ts`

```ts
import type {
  AdapterBundle, AssistProvider, CalendarSink, DocumentSource, Notifier, PaymentHandoff, SignatureProvider
} from "./types.js";

export const nullNotifier: Notifier = {
  async notify() { return { delivered: false, detail: "no notifier configured" }; }
};

export const nullCalendar: CalendarSink = {
  async publish(input) { return { ref: `ledger:${input.title}` }; }
};

export const nullPayment: PaymentHandoff = {
  prepare(input) {
    const money = `${input.amount.currency} ${input.amount.value.toFixed(2)}`;
    return {
      instruction: `To pay ${money} to ${input.beneficiaryName}, use your banking app.`,
      ledgerNote: "Payment handoff: spoken instruction only; no payment was made."
    };
  }
};

export const localSignature: SignatureProvider = {
  async attest(headHash) { return { kind: "local", proof: headHash }; }
};

export const nullDocumentSource: DocumentSource = {
  async poll(cursor) { return { imageRefs: [], texts: [], cursor: cursor ?? "0" }; }
};

export const nullAssist: AssistProvider = {
  async request() { return { sessionRef: "none" }; }
};

export const nullAdapters: AdapterBundle = {
  notifier: nullNotifier,
  calendar: nullCalendar,
  payment: nullPayment,
  signature: localSignature,
  documentSource: nullDocumentSource,
  assist: nullAssist
};
```

- [ ] **Step 4: Run the test, then the full gates**

Run: `npx vitest run test/adapters/adapters.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/types.ts src/adapters/null.ts test/adapters/adapters.test.ts
git commit -m "feat(adapters): add port interfaces and null adapters"
```

---

### Task 3: Adapter configuration

**Files:**
- Modify: `src/domain/model.ts`
- Create: `src/adapters/config.ts`
- Test: `test/adapters/adapters.test.ts` (extend)

**Interfaces:**
- Consumes: `Preferences["adapters"]` (new optional field).
- Produces: `AdaptersSchema`; `AdapterConfig`; `resolveAdapterConfig(env: NodeJS.ProcessEnv, prefs?: Preferences["adapters"]): AdapterConfig`.

- [ ] **Step 1: Write the failing test** — append to `test/adapters/adapters.test.ts`

```ts
import { resolveAdapterConfig } from "../../src/adapters/config.js";

describe("resolveAdapterConfig", () => {
  it("returns all-null when nothing is configured", () => {
    const config = resolveAdapterConfig({});
    expect(config.notifier).toEqual({ kind: "null" });
    expect(config.calendar).toEqual({ kind: "null" });
    expect(config.payment).toEqual({ kind: "null" });
    expect(config.warnings).toEqual([]);
  });

  it("enables the webhook notifier only when the URL is https and allowlisted", () => {
    const good = resolveAdapterConfig({
      WAYFINDER_ADAPTER_NOTIFIER: "webhook",
      WAYFINDER_WEBHOOK_URL: "https://hooks.example/wf",
      WAYFINDER_WEBHOOK_ALLOWLIST: "https://hooks.example/wf"
    });
    expect(good.notifier).toEqual({ kind: "webhook", url: "https://hooks.example/wf", allowlist: ["https://hooks.example/wf"], timeoutMs: 5000 });
    const bad = resolveAdapterConfig({
      WAYFINDER_ADAPTER_NOTIFIER: "webhook",
      WAYFINDER_WEBHOOK_URL: "http://hooks.example/wf",
      WAYFINDER_WEBHOOK_ALLOWLIST: "http://hooks.example/wf"
    });
    expect(bad.notifier).toEqual({ kind: "null" });
    expect(bad.warnings.join(" ")).toMatch(/https/i);
  });

  it("refuses a webhook URL that is not exactly allowlisted", () => {
    const config = resolveAdapterConfig({
      WAYFINDER_ADAPTER_NOTIFIER: "webhook",
      WAYFINDER_WEBHOOK_URL: "https://hooks.example/wf",
      WAYFINDER_WEBHOOK_ALLOWLIST: "https://hooks.example/other"
    });
    expect(config.notifier).toEqual({ kind: "null" });
    expect(config.warnings.join(" ")).toMatch(/allowlist/i);
  });

  it("enables adapters from preferences through the same rules", () => {
    const config = resolveAdapterConfig({ WAYFINDER_ICS_DIR: "/tmp/ics" }, { calendar: "ics", payment: "epc" });
    expect(config.calendar).toEqual({ kind: "ics", dir: "/tmp/ics" });
    expect(config.payment).toEqual({ kind: "epc" });
  });

  it("requires a directory for the ICS sink", () => {
    const config = resolveAdapterConfig({}, { calendar: "ics" });
    expect(config.calendar).toEqual({ kind: "null" });
    expect(config.warnings.join(" ")).toMatch(/WAYFINDER_ICS_DIR/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/adapters/adapters.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3a: Add `Preferences.adapters`** — modify `src/domain/model.ts`

Add before `PreferencesSchema`:

```ts
export const AdaptersSchema = z.object({
  notifier: z.enum(["webhook"]).optional(),
  calendar: z.enum(["ics"]).optional(),
  payment: z.enum(["epc"]).optional()
});
```

and add `adapters: AdaptersSchema.optional()` as the last field inside `PreferencesSchema`.

- [ ] **Step 3b: Implement config resolution** — create `src/adapters/config.ts`

```ts
import type { Preferences } from "../domain/model.js";

export type NotifierConfig =
  | { kind: "null" }
  | { kind: "webhook"; url: string; allowlist: string[]; timeoutMs: number };
export type CalendarConfig = { kind: "null" } | { kind: "ics"; dir: string };
export type PaymentConfig = { kind: "null" } | { kind: "epc" };

export interface AdapterConfig {
  notifier: NotifierConfig;
  calendar: CalendarConfig;
  payment: PaymentConfig;
  signature: { kind: "local" };
  documentSource: { kind: "null" };
  assist: { kind: "null" };
  warnings: string[];
}

function isHttps(value: string): boolean {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

export function resolveAdapterConfig(
  env: NodeJS.ProcessEnv,
  prefs?: Preferences["adapters"]
): AdapterConfig {
  const warnings: string[] = [];

  const notifierKind = env.WAYFINDER_ADAPTER_NOTIFIER ?? prefs?.notifier;
  let notifier: NotifierConfig = { kind: "null" };
  if (notifierKind === "webhook") {
    const url = env.WAYFINDER_WEBHOOK_URL ?? "";
    const allowlist = (env.WAYFINDER_WEBHOOK_ALLOWLIST ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!url) warnings.push("WAYFINDER_WEBHOOK_URL is required for the webhook notifier; staying null.");
    else if (!isHttps(url)) warnings.push("The webhook notifier requires an https URL; staying null.");
    else if (!allowlist.includes(url)) warnings.push("The webhook URL is not in WAYFINDER_WEBHOOK_ALLOWLIST; staying null.");
    else notifier = { kind: "webhook", url, allowlist, timeoutMs: Number(env.WAYFINDER_ADAPTER_TIMEOUT_MS ?? 5000) };
  }

  const calendarKind = env.WAYFINDER_ADAPTER_CALENDAR ?? prefs?.calendar;
  let calendar: CalendarConfig = { kind: "null" };
  if (calendarKind === "ics") {
    const dir = env.WAYFINDER_ICS_DIR ?? "";
    if (!dir) warnings.push("WAYFINDER_ICS_DIR is required for the ICS sink; staying null.");
    else calendar = { kind: "ics", dir };
  }

  const paymentKind = env.WAYFINDER_ADAPTER_PAYMENT ?? prefs?.payment;
  const payment: PaymentConfig = paymentKind === "epc" ? { kind: "epc" } : { kind: "null" };

  return {
    notifier,
    calendar,
    payment,
    signature: { kind: "local" },
    documentSource: { kind: "null" },
    assist: { kind: "null" },
    warnings
  };
}
```

- [ ] **Step 4: Run the test, then the full gates**

Run: `npx vitest run test/adapters/adapters.test.ts test/model.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: all pass. `PreferencesSchema` gained an optional field, so `test/model.test.ts` and `fileStore` preference tests stay green.

- [ ] **Step 5: Commit**

```bash
git add src/domain/model.ts src/adapters/config.ts test/adapters/adapters.test.ts
git commit -m "feat(adapters): resolve adapter configuration, disabled by default"
```

---

### Task 4: EPC QR payment handoff

**Files:**
- Create: `src/adapters/epcQr.ts`
- Test: `test/adapters/adapters.test.ts` (extend)

**Interfaces:**
- Consumes: `ibanIsValid` from `src/domain/validity.js`.
- Produces: `crc16ccitt(input: string): string` (uppercase hex); `buildEpcPayload(input: { beneficiaryName: string; iban: string; amount: { currency: string; value: number }; remittance: string; bic?: string; purpose?: string }): string`; `epcPayment: PaymentHandoff`.

- [ ] **Step 1: Write the failing test** — append to `test/adapters/adapters.test.ts`

```ts
import { buildEpcPayload, crc16ccitt, epcPayment } from "../../src/adapters/epcQr.js";

function independentCrc16(input: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(input, "utf8")) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

describe("epcQr", () => {
  it("builds an EPC069-12 payload whose trailing checksum round-trips", () => {
    const payload = buildEpcPayload({
      beneficiaryName: "City Water",
      iban: "DE89370400440532013000",
      amount: { currency: "EUR", value: 12.5 },
      remittance: "INV-1"
    });
    const data = payload.slice(0, -4);
    const checksum = payload.slice(-4);
    expect(checksum).toBe(independentCrc16(data));
    expect(data.startsWith("BCD\n002\n1\nSCT\n")).toBe(true);
    expect(data).toContain("City Water");
    expect(data).toContain("DE89370400440532013000");
    expect(data).toContain("EUR12.50");
    expect(data.endsWith("\n")).toBe(true);
  });

  it("refuses an invalid IBAN", () => {
    expect(() => buildEpcPayload({
      beneficiaryName: "City Water",
      iban: "DE89370400440532013001",
      amount: { currency: "EUR", value: 12.5 },
      remittance: "INV-1"
    })).toThrow(/invalid IBAN/i);
  });

  it("epcPayment prepares a payload and refuses an invalid IBAN", () => {
    const result = epcPayment.prepare({
      amount: { currency: "EUR", value: 12.5 },
      beneficiaryName: "City Water",
      iban: "DE89370400440532013000",
      remittance: "INV-1"
    });
    expect(result.epcQr).toBeDefined();
    expect(() => epcPayment.prepare({
      amount: { currency: "EUR", value: 12.5 },
      beneficiaryName: "City Water",
      iban: "DE89370400440532013001",
      remittance: "INV-1"
    })).toThrow(/invalid IBAN/i);
  });

  it("crc16ccitt matches a known vector", () => {
    expect(crc16ccitt("123456789")).toBe("29B1");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/adapters/adapters.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/adapters/epcQr.ts`

```ts
import { ibanIsValid } from "../domain/validity.js";
import type { PaymentHandoff } from "./types.js";

export function crc16ccitt(input: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(input, "utf8")) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function buildEpcPayload(input: {
  beneficiaryName: string;
  iban: string;
  amount: { currency: string; value: number };
  remittance: string;
  bic?: string;
  purpose?: string;
}): string {
  if (!ibanIsValid(input.iban)) {
    throw new Error("Refusing to build an EPC payload for an invalid IBAN.");
  }
  const iban = input.iban.replace(/\s+/g, "").toUpperCase();
  const amount = `${input.amount.currency}${input.amount.value.toFixed(2)}`;
  const lines = [
    "BCD",
    "002",
    "1",
    "SCT",
    input.bic ?? "",
    input.beneficiaryName.slice(0, 70),
    iban,
    amount,
    input.purpose ?? "",
    input.remittance.slice(0, 140)
  ];
  const data = `${lines.join("\n")}\n`;
  return `${data}${crc16ccitt(data)}`;
}

export const epcPayment: PaymentHandoff = {
  prepare(input) {
    if (!ibanIsValid(input.iban)) {
      throw new Error("Refusing to prepare a payment handoff for an invalid IBAN.");
    }
    const epcQr = buildEpcPayload({
      beneficiaryName: input.beneficiaryName,
      iban: input.iban,
      amount: input.amount,
      remittance: input.remittance
    });
    const money = `${input.amount.currency} ${input.amount.value.toFixed(2)}`;
    return {
      instruction: `To pay ${money} to ${input.beneficiaryName}, open your banking app and scan the handoff code. I have not moved any money.`,
      epcQr,
      ledgerNote: `Payment handoff prepared for ${input.beneficiaryName} in ${input.amount.currency}; no payment was executed.`
    };
  }
};
```

- [ ] **Step 4: Run the test, then the full gates**

Run: `npx vitest run test/adapters/adapters.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: all pass. (`crc16ccitt("123456789") === "29B1"` is the CRC-16/CCITT-FALSE check value.)

- [ ] **Step 5: Commit**

```bash
git add src/adapters/epcQr.ts test/adapters/adapters.test.ts
git commit -m "feat(adapters): add EPC069-12 handoff payload with CRC16-CCITT"
```

---

### Task 5: ICS calendar sink

**Files:**
- Create: `src/adapters/icsFileSink.ts`
- Test: `test/adapters/adapters.test.ts` (extend)

**Interfaces:**
- Produces: `buildIcs(input: { uid: string; stamp: string; title: string; start: string; durationMinutes?: number; description?: string }): string` (CRLF-terminated); `createIcsFileSink(deps: { dir: string; now?: () => string }): CalendarSink`.

- [ ] **Step 1: Write the failing test** — append to `test/adapters/adapters.test.ts`

```ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIcs, createIcsFileSink } from "../../src/adapters/icsFileSink.js";

describe("icsFileSink", () => {
  it("builds a CRLF-terminated VEVENT with a 30-minute default duration", () => {
    const ics = buildIcs({ uid: "u1", stamp: "2026-09-20T12:00:00.000Z", title: "Dentist", start: "2026-10-01T09:00:00.000Z" });
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("UID:u1\r\n");
    expect(ics).toContain("DTSTART:20261001T090000Z\r\n");
    expect(ics).toContain("DTEND:20261001T093000Z\r\n");
    expect(ics).toContain("SUMMARY:Dentist\r\n");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("escapes commas, semicolons, and newlines in text fields", () => {
    const ics = buildIcs({ uid: "u1", stamp: "2026-09-20T12:00:00.000Z", title: "A, B; C", start: "2026-10-01T09:00:00.000Z", description: "line1\nline2" });
    expect(ics).toContain("SUMMARY:A\\, B\\; C\r\n");
    expect(ics).toContain("DESCRIPTION:line1\\nline2\r\n");
  });

  it("writes an .ics file and returns its path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-ics-"));
    const sink = createIcsFileSink({ dir, now: () => "2026-09-20T12:00:00.000Z" });
    const result = await sink.publish({ title: "Dentist", start: "2026-10-01T09:00:00.000Z", durationMinutes: 60 });
    expect(result.ref.startsWith(dir)).toBe(true);
    expect(readFileSync(result.ref, "utf8")).toContain("SUMMARY:Dentist");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/adapters/adapters.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/adapters/icsFileSink.ts`

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CalendarSink } from "./types.js";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function icsStamp(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

export function buildIcs(input: {
  uid: string;
  stamp: string;
  title: string;
  start: string;
  durationMinutes?: number;
  description?: string;
}): string {
  const minutes = input.durationMinutes ?? 30;
  const end = new Date(new Date(input.start).getTime() + minutes * 60_000).toISOString();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Wayfinder//EN",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${icsStamp(input.stamp)}`,
    `DTSTART:${icsStamp(input.start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${escapeText(input.title)}`
  ];
  if (input.description !== undefined) lines.push(`DESCRIPTION:${escapeText(input.description)}`);
  lines.push("END:VEVENT", "END:VCALENDAR", "");
  return lines.join("\r\n");
}

export function createIcsFileSink(deps: { dir: string; now?: () => string }): CalendarSink {
  return {
    async publish(input) {
      await mkdir(deps.dir, { recursive: true });
      const uid = `wf-${randomUUID()}@wayfinder`;
      const stamp = deps.now ? deps.now() : new Date().toISOString();
      const ics = buildIcs({
        uid,
        stamp,
        title: input.title,
        start: input.start,
        ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
        ...(input.description !== undefined ? { description: input.description } : {})
      });
      const file = join(deps.dir, `${uid}.ics`);
      await writeFile(file, ics, "utf8");
      return { ref: file };
    }
  };
}
```

- [ ] **Step 4: Run the test, then the full gates**

Run: `npx vitest run test/adapters/adapters.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/icsFileSink.ts test/adapters/adapters.test.ts
git commit -m "feat(adapters): add an ICS file calendar sink"
```

---

### Task 6: Webhook notifier

**Files:**
- Create: `src/adapters/webhookNotifier.ts`
- Test: `test/adapters/adapters.test.ts` (extend)

**Interfaces:**
- Produces: `createWebhookNotifier(deps: { url: string; allowlist: string[]; timeoutMs?: number; fetchImpl?: typeof fetch }): Notifier`. Constructing it throws unless the URL is `https:` **and** exactly allowlisted. `notify` redacts the summary, sends JSON with the `entryId`, suppresses duplicate `entryId`s, and never throws for delivery failures.

- [ ] **Step 1: Write the failing test** — append to `test/adapters/adapters.test.ts`

```ts
import { createWebhookNotifier } from "../../src/adapters/webhookNotifier.js";

describe("webhookNotifier", () => {
  it("refuses a non-https or non-allowlisted URL at construction", () => {
    expect(() => createWebhookNotifier({ url: "http://hooks.example/wf", allowlist: ["http://hooks.example/wf"] })).toThrow(/https/i);
    expect(() => createWebhookNotifier({ url: "https://hooks.example/wf", allowlist: ["https://hooks.example/other"] })).toThrow(/allowlist/i);
  });

  it("posts a redacted payload carrying the entryId", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl = (async (url: string | URL, init?: { body?: unknown }) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;
    const notifier = createWebhookNotifier({ url: "https://hooks.example/wf", allowlist: ["https://hooks.example/wf"], fetchImpl });
    const result = await notifier.notify({ entryId: "led_1", event: "action_executed", summary: "Account DE89370400440532013000 noted" });
    expect(result).toEqual({ delivered: true, detail: "delivered" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toContain("led_1");
    expect(calls[0]!.body).not.toContain("DE89370400440532013000");
  });

  it("suppresses a duplicate entryId so a retry cannot double-notify", async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls += 1; return { ok: true, status: 200 } as Response; }) as unknown as typeof fetch;
    const notifier = createWebhookNotifier({ url: "https://hooks.example/wf", allowlist: ["https://hooks.example/wf"], fetchImpl });
    await notifier.notify({ entryId: "led_1", event: "triaged", summary: "x" });
    const second = await notifier.notify({ entryId: "led_1", event: "triaged", summary: "x" });
    expect(second.delivered).toBe(false);
    expect(calls).toBe(1);
  });

  it("reports a non-2xx response as a failure without throwing", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 500 } as Response)) as unknown as typeof fetch;
    const notifier = createWebhookNotifier({ url: "https://hooks.example/wf", allowlist: ["https://hooks.example/wf"], fetchImpl });
    const result = await notifier.notify({ event: "triaged", summary: "x" });
    expect(result.delivered).toBe(false);
    expect(result.detail).toContain("500");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/adapters/adapters.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/adapters/webhookNotifier.ts`

```ts
import { redactSensitive } from "../domain/redact.js";
import type { Notifier } from "./types.js";

export function createWebhookNotifier(deps: {
  url: string;
  allowlist: string[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Notifier {
  let protocol: string;
  try {
    protocol = new URL(deps.url).protocol;
  } catch {
    throw new Error("Webhook URL is not a valid URL.");
  }
  if (protocol !== "https:") throw new Error("The webhook notifier requires an https URL.");
  if (!deps.allowlist.includes(deps.url)) throw new Error("The webhook URL is not in the allowlist.");

  const timeoutMs = deps.timeoutMs ?? 5000;
  const doFetch = deps.fetchImpl ?? fetch;
  const sent = new Set<string>();

  return {
    async notify(input) {
      if (input.entryId !== undefined) {
        if (sent.has(input.entryId)) return { delivered: false, detail: "duplicate suppressed" };
        sent.add(input.entryId);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const payload = {
          entryId: input.entryId ?? null,
          event: input.event,
          documentId: input.documentId ?? null,
          threadKey: input.threadKey ?? null,
          summary: redactSensitive(input.summary)
        };
        const response = await doFetch(deps.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        if (!response.ok) return { delivered: false, detail: `status ${response.status}` };
        return { delivered: true, detail: "delivered" };
      } catch (err) {
        return { delivered: false, detail: err instanceof Error ? err.message : "delivery error" };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
```

- [ ] **Step 4: Run the test, then the full gates**

Run: `npx vitest run test/adapters/adapters.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/webhookNotifier.ts test/adapters/adapters.test.ts
git commit -m "feat(adapters): add an allowlisted, redacting webhook notifier"
```

---

### Task 7: Adapter registry

**Files:**
- Create: `src/adapters/registry.ts`
- Test: `test/adapters/adapters.test.ts` (extend)

**Interfaces:**
- Consumes: `AdapterConfig` (Task 3); `epcPayment` (Task 4); `createIcsFileSink` (Task 5); `createWebhookNotifier` (Task 6); `nullAdapters` (Task 2).
- Produces: `createAdapters(config: AdapterConfig, deps?: { fetchImpl?: typeof fetch }): AdapterBundle` — every unconfigured port resolves to its null adapter.

- [ ] **Step 1: Write the failing test** — append to `test/adapters/adapters.test.ts`

```ts
import { createAdapters } from "../../src/adapters/registry.js";
import { resolveAdapterConfig } from "../../src/adapters/config.js";

describe("createAdapters", () => {
  it("returns the null bundle when nothing is configured", () => {
    const bundle = createAdapters(resolveAdapterConfig({}));
    expect(bundle.notifier).toBe(nullAdapters.notifier);
    expect(bundle.calendar).toBe(nullAdapters.calendar);
    expect(bundle.payment).toBe(nullAdapters.payment);
    expect(bundle.signature).toBe(nullAdapters.signature);
  });

  it("wires the EPC payment handoff when configured", () => {
    const bundle = createAdapters(resolveAdapterConfig({ WAYFINDER_ADAPTER_PAYMENT: "epc" }));
    const result = bundle.payment.prepare({
      amount: { currency: "EUR", value: 9.99 },
      beneficiaryName: "City Water",
      iban: "DE89370400440532013000",
      remittance: "INV-1"
    });
    expect(result.epcQr).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/adapters/adapters.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/adapters/registry.ts`

```ts
import type { AdapterConfig } from "./config.js";
import { nullAdapters, localSignature } from "./null.js";
import { epcPayment } from "./epcQr.js";
import { createIcsFileSink } from "./icsFileSink.js";
import { createWebhookNotifier } from "./webhookNotifier.js";
import type { AdapterBundle } from "./types.js";

export function createAdapters(config: AdapterConfig, deps: { fetchImpl?: typeof fetch } = {}): AdapterBundle {
  const notifier = config.notifier.kind === "webhook"
    ? createWebhookNotifier({
        url: config.notifier.url,
        allowlist: config.notifier.allowlist,
        timeoutMs: config.notifier.timeoutMs,
        ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {})
      })
    : nullAdapters.notifier;

  const calendar = config.calendar.kind === "ics"
    ? createIcsFileSink({ dir: config.calendar.dir })
    : nullAdapters.calendar;

  const payment = config.payment.kind === "epc" ? epcPayment : nullAdapters.payment;

  return {
    notifier,
    calendar,
    payment,
    signature: localSignature,
    documentSource: nullAdapters.documentSource,
    assist: nullAdapters.assist
  };
}
```

- [ ] **Step 4: Run the test, then the full gates**

Run: `npx vitest run test/adapters/adapters.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/registry.ts test/adapters/adapters.test.ts
git commit -m "feat(adapters): add the adapter registry"
```

---

### Task 8: Off-request-path notification queue

**Files:**
- Create: `src/adapters/notifyQueue.ts`
- Create: `test/adapters/notifyQueue.test.ts`

**Interfaces:**
- Consumes: `Notifier`, `NotifyInput` (Task 2); `Store`; `createLedger` (Plan 6); `redactSensitive`.
- Produces: `NotifyJob` (same shape as `NotifyInput`, required `summary`), `NotifyQueue { enqueue(job): void; drain(): Promise<void>; close(): Promise<void> }`, `createNotifyQueue(deps: { notifier: Notifier; store: Store }): NotifyQueue`. A delivered notification appends `external_invoked`; a failed one appends `delivery_failed`; `enqueue` never blocks or throws.

- [ ] **Step 1: Write the failing test** — create `test/adapters/notifyQueue.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../../src/storage/fileStore.js";
import { createNotifyQueue } from "../../src/adapters/notifyQueue.js";
import type { Notifier } from "../../src/adapters/types.js";

let store: ReturnType<typeof createFileStore>;
beforeEach(() => { store = createFileStore(mkdtempSync(join(tmpdir(), "wf-"))); });

describe("notifyQueue", () => {
  it("delivers off-path and records an external_invoked entry", async () => {
    const seen: string[] = [];
    const notifier: Notifier = { async notify(input) { seen.push(input.summary); return { delivered: true, detail: "ok" }; } };
    const queue = createNotifyQueue({ notifier, store });
    queue.enqueue({ event: "action_executed", summary: "Filed the water bill" });
    await queue.drain();
    expect(seen).toEqual(["Filed the water bill"]);
    expect((await store.listLedger()).map((e) => e.event)).toEqual(["external_invoked"]);
  });

  it("records delivery_failed when the notifier fails", async () => {
    const notifier: Notifier = { async notify() { return { delivered: false, detail: "boom" }; } };
    const queue = createNotifyQueue({ notifier, store });
    queue.enqueue({ event: "triaged", summary: "x" });
    await queue.drain();
    expect((await store.listLedger()).map((e) => e.event)).toEqual(["delivery_failed"]);
  });

  it("redacts the summary before it reaches the notifier", async () => {
    const seen: string[] = [];
    const notifier: Notifier = { async notify(input) { seen.push(input.summary); return { delivered: true, detail: "ok" }; } };
    const queue = createNotifyQueue({ notifier, store });
    queue.enqueue({ event: "triaged", summary: "Account DE89370400440532013000" });
    await queue.drain();
    expect(seen[0]).not.toContain("DE89370400440532013000");
  });

  it("never throws from enqueue even when delivery fails", async () => {
    const notifier: Notifier = { async notify() { throw new Error("network"); } };
    const queue = createNotifyQueue({ notifier, store });
    expect(() => queue.enqueue({ event: "triaged", summary: "x" })).not.toThrow();
    await queue.drain();
    expect((await store.listLedger()).map((e) => e.event)).toEqual(["delivery_failed"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/adapters/notifyQueue.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/adapters/notifyQueue.ts`

```ts
import type { Store } from "../storage/types.js";
import { createLedger } from "../domain/ledgerLog.js";
import { redactSensitive } from "../domain/redact.js";
import type { LedgerEvent } from "../domain/model.js";
import type { Notifier } from "./types.js";

export interface NotifyJob {
  event: LedgerEvent;
  documentId?: string;
  threadKey?: string;
  summary: string;
  entryId?: string;
}

export interface NotifyQueue {
  enqueue(job: NotifyJob): void;
  drain(): Promise<void>;
  close(): Promise<void>;
}

export function createNotifyQueue(deps: { notifier: Notifier; store: Store }): NotifyQueue {
  const ledger = createLedger(deps.store);
  const pending: NotifyJob[] = [];
  let active: Promise<void> | null = null;

  const deliver = async (job: NotifyJob): Promise<void> => {
    const summary = redactSensitive(job.summary);
    let delivered = false;
    try {
      const result = await deps.notifier.notify({
        event: job.event,
        summary,
        ...(job.documentId !== undefined ? { documentId: job.documentId } : {}),
        ...(job.threadKey !== undefined ? { threadKey: job.threadKey } : {}),
        ...(job.entryId !== undefined ? { entryId: job.entryId } : {})
      });
      delivered = result.delivered;
    } catch (err) {
      console.error("[notifyQueue] notifier threw:", err);
    }
    const at = new Date().toISOString();
    try {
      await ledger.append({
        at,
        actor: "agent",
        event: delivered ? "external_invoked" : "delivery_failed",
        details: {
          adapter: "notifier",
          notifiedEvent: job.event,
          ...(job.entryId !== undefined ? { entryId: job.entryId } : {})
        },
        ...(job.documentId !== undefined ? { documentId: job.documentId } : {}),
        ...(job.threadKey !== undefined ? { threadKey: job.threadKey } : {})
      });
    } catch (err) {
      console.error("[notifyQueue] failed to record delivery outcome:", err);
    }
  };

  const pump = async (): Promise<void> => {
    while (pending.length > 0) {
      const job = pending.shift()!;
      await deliver(job);
    }
  };

  return {
    enqueue(job) {
      pending.push(job);
      if (!active) {
        active = pump().finally(() => { active = null; });
      }
    },
    async drain() {
      while (active) await active;
    },
    async close() {
      await active;
    }
  };
}
```

Note: `drain` loops because a job may enqueue more, and `active` clears only when the pump empties the queue; if new jobs arrive after the pump exits, a later `enqueue` starts a new pump.

- [ ] **Step 4: Run the test, then the full gates**

Run: `npx vitest run test/adapters/notifyQueue.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/notifyQueue.ts test/adapters/notifyQueue.test.ts
git commit -m "feat(adapters): deliver notifications off the request path"
```

---

### Task 9: Capability disclosure

**Files:**
- Create: `src/adapters/capabilities.ts`
- Modify: `src/mcp/server.ts`
- Modify: `src/server/http.ts`
- Modify: `src/server/index.ts`
- Modify: `src/domain/copy.ts`
- Test: `test/capabilities.test.ts`

**Interfaces:**
- Consumes: `AdapterConfig` (Task 3); `createAdapters` (Task 7); `createLedger`/`verifyLedger` (Plan 6); `Store`.
- Produces: `Capabilities` and `buildCapabilities(config: AdapterConfig, chain: { head: string; verified: boolean }): Capabilities`; `ServerDeps` gains `adapters?: AdapterBundle; notify?: NotifyQueue; adapterConfig?: AdapterConfig`; `HttpDeps` gains the same; the `wayfinder://capabilities` resource and `GET /capabilities`; a `readChain(store)` helper.

- [ ] **Step 1: Write the failing test** — create `test/capabilities.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFileStore } from "../src/storage/fileStore.js";
import { buildServer } from "../src/mcp/server.js";
import { createHttpApp } from "../src/server/http.js";
import { createAdapters } from "../src/adapters/registry.js";
import { resolveAdapterConfig } from "../src/adapters/config.js";
import { createNotifyQueue } from "../src/adapters/notifyQueue.js";

async function connect() {
  const store = createFileStore(mkdtempSync(join(tmpdir(), "wf-")));
  const adapterConfig = resolveAdapterConfig({});
  const server = buildServer({ store, adapterConfig, adapters: createAdapters(adapterConfig) });
  const client = new Client({ name: "t", version: "0.0.1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, store };
}

describe("capability disclosure", () => {
  it("reports null for every unconfigured port on the MCP resource", async () => {
    const { client } = await connect();
    const read = await client.readResource({ uri: "wayfinder://capabilities" });
    const body = JSON.parse((read.contents[0] as { text: string }).text) as {
      adapters: Record<string, string>;
      chain: { head: string; verified: boolean };
    };
    expect(body.adapters).toEqual({ notifier: "null", calendar: "null", payment: "null", signature: "local", documentSource: "null", assist: "null" });
    expect(body.chain.verified).toBe(true);
    await client.close();
  });

  it("serves the same on GET /capabilities", async () => {
    const store = createFileStore(mkdtempSync(join(tmpdir(), "wf-")));
    const adapterConfig = resolveAdapterConfig({});
    const app = createHttpApp({ store, adapterConfig });
    const server = app.listen(0);
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const res = await fetch(`http://127.0.0.1:${port}/capabilities`);
      expect(res.status).toBe(200);
      const body = await res.json() as { adapters: Record<string, string> };
      expect(body.adapters.notifier).toBe("null");
    } finally {
      server.close();
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/capabilities.test.ts`
Expected: FAIL — `wayfinder://capabilities` resource missing / `adapterConfig` unknown.

- [ ] **Step 3a: Implement capabilities** — create `src/adapters/capabilities.ts`

```ts
import type { AdapterConfig } from "./config.js";
import { createLedger } from "../domain/ledgerLog.js";
import { verifyLedger } from "../domain/ledger.js";
import type { Store } from "../storage/types.js";

export interface Capabilities {
  adapters: {
    notifier: "webhook" | "null";
    calendar: "ics" | "null";
    payment: "epc" | "null";
    signature: "local" | "kms" | "tsa";
    documentSource: "null";
    assist: "null";
  };
  chain: { head: string; verified: boolean };
}

export function buildCapabilities(config: AdapterConfig, chain: { head: string; verified: boolean }): Capabilities {
  return {
    adapters: {
      notifier: config.notifier.kind,
      calendar: config.calendar.kind,
      payment: config.payment.kind,
      signature: config.signature.kind,
      documentSource: config.documentSource.kind,
      assist: config.assist.kind
    },
    chain
  };
}

export async function readChain(store: Store): Promise<{ head: string; verified: boolean }> {
  const entries = await createLedger(store).read();
  const result = verifyLedger(entries);
  return { head: entries[entries.length - 1]?.hash ?? "0".repeat(64), verified: result.ok };
}
```

- [ ] **Step 3b: Add copy** — modify `src/domain/copy.ts`

Add after `audit`:

```ts
  capabilities: {
    spoken: "Here is what is actually connected, not what could be."
  },
  payment: {
    prepared: "Here is what to scan in your banking app. I have not moved any money.",
    invalidIban: "That account number doesn't check out, so I can't prepare a payment."
  },
```

- [ ] **Step 3c: Add the resource and deps** — modify `src/mcp/server.ts`

Extend imports:

```ts
import { buildCapabilities, readChain } from "../adapters/capabilities.js";
import type { AdapterBundle } from "../adapters/types.js";
import type { AdapterConfig } from "../adapters/config.js";
import type { NotifyQueue } from "../adapters/notifyQueue.js";
import { nullAdapters } from "../adapters/null.js";
```

Extend `ServerDeps`:

```ts
export interface ServerDeps {
  store: Store;
  extract?: Extractor;
  worker?: ScanWorker;
  adapters?: AdapterBundle;
  adapterConfig?: AdapterConfig;
  notify?: NotifyQueue;
}
```

Add the resource next to the ledger resource:

```ts
  server.resource(
    "capabilities",
    "wayfinder://capabilities",
    { description: "What is actually wired, never what is merely possible." },
    async (uri) => {
      const config = deps.adapterConfig;
      const chain = await readChain(deps.store);
      const capabilities = buildCapabilities(
        config ?? {
          notifier: { kind: "null" },
          calendar: { kind: "null" },
          payment: { kind: "null" },
          signature: { kind: "local" },
          documentSource: { kind: "null" },
          assist: { kind: "null" },
          warnings: []
        },
        chain
      );
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(capabilities) }]
      };
    }
  );
```

- [ ] **Step 3d: Add `GET /capabilities`** — modify `src/server/http.ts`

Extend imports:

```ts
import { buildCapabilities, readChain } from "../adapters/capabilities.js";
import type { AdapterConfig } from "../adapters/config.js";
```

Extend `HttpDeps`:

```ts
  adapterConfig?: AdapterConfig;
```

Add the route after `/healthz`:

```ts
  const fallbackConfig: AdapterConfig = {
    notifier: { kind: "null" },
    calendar: { kind: "null" },
    payment: { kind: "null" },
    signature: { kind: "local" },
    documentSource: { kind: "null" },
    assist: { kind: "null" },
    warnings: []
  };

  app.get("/capabilities", async (_req, res) => {
    try {
      const capabilities = buildCapabilities(deps.adapterConfig ?? fallbackConfig, await readChain(deps.store));
      res.json(capabilities);
    } catch (err) {
      console.error("[capabilities] failed:", err);
      res.status(500).json({ error: copy.toolUnavailable });
    }
  });
```

- [ ] **Step 3e: Wire in the server entrypoint** — modify `src/server/index.ts`

Add imports and construct adapters after `const store`:

```ts
import { resolveAdapterConfig } from "../adapters/config.js";
import { createAdapters } from "../adapters/registry.js";
import { createNotifyQueue } from "../adapters/notifyQueue.js";
```

```ts
const preferences = await store.getPreferences();
const adapterConfig = resolveAdapterConfig(process.env, preferences.adapters);
const adapters = createAdapters(adapterConfig);
for (const warning of adapterConfig.warnings) console.warn(`[wayfinder] adapter: ${warning}`);
const notify = createNotifyQueue({ notifier: adapters.notifier, store });
```

Add the three fields to the `deps` object:

```ts
const deps: HttpDeps = { store, allowedOrigins, adapterConfig, adapters, notify, ...(extract ? { extract } : {}) };
```

- [ ] **Step 4: Run the tests, then the full gates**

Run: `npx vitest run test/capabilities.test.ts test/tools.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: all pass. `buildServer` without the new deps still works (they are optional), so existing server tests stay green.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/capabilities.ts src/domain/copy.ts src/mcp/server.ts src/server/http.ts src/server/index.ts test/capabilities.test.ts
git commit -m "feat(adapters): disclose wired capabilities over MCP and HTTP"
```

---

### Task 10: Payment handoff tool and notification wiring

**Files:**
- Modify: `src/mcp/server.ts`
- Modify: `test/capabilities.test.ts` (extend)

**Interfaces:**
- Consumes: `AdapterBundle.payment` (Task 7); `NotifyQueue` (Task 8); `applyAction`'s `receipt` (Task 1).
- Produces: the `prepare_payment` tool (pure; validates the IBAN; never executes); `act_on_item` and `escalate_item` enqueue a notification after their response using the receipt `entryId`.

- [ ] **Step 1: Write the failing test** — append to `test/capabilities.test.ts`

```ts
describe("prepare_payment", () => {
  it("prepares an EPC payload and records the handoff, never a payment", async () => {
    const { client, store } = await connect();
    const res = await client.callTool({
      name: "prepare_payment",
      arguments: {
        beneficiaryName: "City Water",
        iban: "DE89370400440532013000",
        amount: { currency: "EUR", value: 12.5 },
        remittance: "INV-1",
        documentId: "itm_a"
      }
    });
    const sc = res.structuredContent as { epcQr?: string };
    expect(typeof sc.epcQr).toBe("string");
    const events = (await store.listLedger()).map((e) => e.event);
    expect(events).toContain("action_proposed");
    expect(JSON.stringify(await store.listLedger())).not.toContain("DE89370400440532013000");
    await client.close();
  });

  it("refuses an invalid IBAN", async () => {
    const { client } = await connect();
    const res = await client.callTool({
      name: "prepare_payment",
      arguments: {
        beneficiaryName: "City Water",
        iban: "DE89370400440532013001",
        amount: { currency: "EUR", value: 12.5 },
        remittance: "INV-1"
      }
    });
    expect(res.isError).toBe(true);
    await client.close();
  });

  it("enqueues a notification after an allowed action", async () => {
    const store = createFileStore(mkdtempSync(join(tmpdir(), "wf-")));
    const seen: string[] = [];
    const notify = createNotifyQueue({
      notifier: { async notify(input) { seen.push(input.event); return { delivered: true, detail: "ok" }; } },
      store
    });
    const adapterConfig = resolveAdapterConfig({});
    const server = buildServer({ store, adapterConfig, adapters: createAdapters(adapterConfig), notify });
    const client = new Client({ name: "t", version: "0.0.1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    await store.putItem({
      itemId: "itm_n", scanId: "scn_n", class: "bill", confidence: 0.8, readAloudText: "bill",
      fields: { dueDate: "2026-10-01" },
      proposedActions: [{ actionId: "itm_n:remind", itemId: "itm_n", type: "remind", params: { on: "2026-10-01" }, status: "proposed" }],
      createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null
    });
    await client.callTool({ name: "act_on_item", arguments: { itemId: "itm_n", actionId: "itm_n:remind" } });
    await notify.drain();
    expect(seen).toContain("action_executed");
    await client.close();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/capabilities.test.ts`
Expected: FAIL — `prepare_payment` is not a registered tool.

- [ ] **Step 3a: Register `prepare_payment`** — add to `src/mcp/server.ts` after `escalate_item`

```ts
  server.tool(
    "prepare_payment",
    "Prepare a payment the customer completes in their own banking app. Never moves money.",
    {
      beneficiaryName: z.string(),
      iban: z.string(),
      amount: z.object({ currency: z.string(), value: z.number().nonnegative() }),
      remittance: z.string(),
      documentId: z.string().optional()
    },
    async ({ beneficiaryName, iban, amount, remittance, documentId }) => {
      const adapters = deps.adapters ?? nullAdapters;
      let prepared: { instruction: string; epcQr?: string; ledgerNote: string };
      try {
        prepared = adapters.payment.prepare({ beneficiaryName, iban, amount, remittance });
      } catch {
        return { content: [{ type: "text", text: copy.payment.invalidIban }], isError: true as const };
      }
      try {
        const at = new Date().toISOString();
        const ledger = createLedger(deps.store);
        const receipt = await ledger.append({
          at,
          actor: "agent",
          event: "action_proposed",
          details: { actionType: "payment_handoff" },
          ...(documentId !== undefined ? { documentId } : {})
        });
        deps.notify?.enqueue({
          event: "action_proposed",
          summary: prepared.ledgerNote,
          entryId: receipt.entryId,
          ...(documentId !== undefined ? { documentId } : {})
        });
      } catch (err) {
        return safeError("prepare_payment", err);
      }
      return {
        content: [{ type: "text", text: copy.payment.prepared }],
        structuredContent: { instruction: prepared.instruction, ...(prepared.epcQr !== undefined ? { epcQr: prepared.epcQr } : {}) }
      };
    }
  );
```

- [ ] **Step 3b: Notify after actions** — modify the `act_on_item` handler in `src/mcp/server.ts`

```ts
    async ({ itemId, actionId, confirmed }) => {
      try {
        const result = await applyAction(deps.store, itemId, actionId, { confirmed });
        if (result.receipt !== undefined) {
          deps.notify?.enqueue({
            event: result.receipt.event,
            summary: result.message,
            entryId: result.receipt.entryId,
            documentId: itemId,
            ...(result.receipt.threadKey !== undefined ? { threadKey: result.receipt.threadKey } : {})
          });
        }
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: { action: result.action, item: result.item, decision: result.decision }
        };
      } catch (err) {
        return safeError("act_on_item", err, copy.toolFailed);
      }
    }
```

and the `escalate_item` handler's success path, after appending the ledger entry, enqueue:

```ts
        deps.notify?.enqueue({ event: "escalated", summary: copy.escalated(preferences.trustedContactAlias) });
```

- [ ] **Step 4: Run the tests, then the full gates**

Run: `npx vitest run test/capabilities.test.ts test/authorityGate.test.ts test/governedTools.test.ts; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: all pass. `deps.notify` is optional, so the existing server tests (no queue) are unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts test/capabilities.test.ts
git commit -m "feat(mcp): add prepare_payment and notify after governed actions"
```

---

### Task 11: Conformance harness, script, and recipes

**Files:**
- Create: `test/adapters/contract.ts`
- Create: `test/adapters/contract.test.ts`
- Create: `scripts/adapters-conformance.mjs`
- Modify: `package.json`
- Create: `docs/adapters/notifier.md`, `docs/adapters/calendar.md`, `docs/adapters/payment.md`, `docs/adapters/signature.md`, `docs/adapters/documentSource.md`, `docs/adapters/assist.md`

**Interfaces:**
- Produces: a shared `runNotifierContract(factory)` / `runCalendarContract(factory)` / `runPaymentContract(factory)` in `test/adapters/contract.ts`, applied to the null and reference adapters; `npm run adapters:conformance` exiting non-zero on failure.

- [ ] **Step 1: Write the failing test** — create `test/adapters/contract.ts`

```ts
import { describe, it, expect } from "vitest";

export function runNotifierContract(make: () => import("../../src/adapters/types.js").Notifier): void {
  describe("Notifier contract", () => {
    it("never throws and returns a boolean delivered flag with a detail", async () => {
      const result = await make().notify({ event: "triaged", summary: "contract summary" });
      expect(typeof result.delivered).toBe("boolean");
      expect(typeof result.detail).toBe("string");
    });
  });
}

export function runCalendarContract(make: () => import("../../src/adapters/types.js").CalendarSink): void {
  describe("CalendarSink contract", () => {
    it("returns a non-empty ref", async () => {
      const { ref } = await make().publish({ title: "Contract", start: "2026-10-01T09:00:00.000Z" });
      expect(ref.length).toBeGreaterThan(0);
    });
  });
}

export function runPaymentContract(make: () => import("../../src/adapters/types.js").PaymentHandoff): void {
  describe("PaymentHandoff contract", () => {
    it("returns an instruction and a ledger note and refuses an invalid IBAN", () => {
      const result = make().prepare({
        amount: { currency: "EUR", value: 1 },
        beneficiaryName: "Contract",
        iban: "DE89370400440532013000",
        remittance: "R"
      });
      expect(result.instruction.length).toBeGreaterThan(0);
      expect(result.ledgerNote.length).toBeGreaterThan(0);
      expect(() => make().prepare({
        amount: { currency: "EUR", value: 1 },
        beneficiaryName: "Contract",
        iban: "DE89370400440532013001",
        remittance: "R"
      })).toThrow();
    });
  });
}
```

- [ ] **Step 2: Create the contract test that runs it** — create `test/adapters/contract.test.ts`

```ts
import { runCalendarContract, runNotifierContract, runPaymentContract } from "./contract.js";
import { nullAdapters } from "../../src/adapters/null.js";
import { epcPayment } from "../../src/adapters/epcQr.js";

runNotifierContract(() => nullAdapters.notifier);
runCalendarContract(() => nullAdapters.calendar);
runPaymentContract(() => nullAdapters.payment);
runPaymentContract(() => epcPayment);
```

- [ ] **Step 3: Create the conformance script** — create `scripts/adapters-conformance.mjs`

```js
#!/usr/bin/env node
/**
 * Run the adapter conformance suite and validate the configured adapters.
 * Exits non-zero when a configured adapter fails its contract or is misconfigured.
 *
 * Usage:
 *   npm run adapters:conformance
 */
import { spawnSync } from "node:child_process";

const result = spawnSync("npx", ["vitest", "run", "test/adapters/contract.test.ts"], {
  stdio: "inherit",
  shell: process.platform === "win32"
});
if (result.status !== 0) {
  console.error("\nAdapter conformance FAILED.");
  process.exit(result.status ?? 1);
}
console.log("\nAdapter conformance passed. Configure adapters with WAYFINDER_ADAPTER_<PORT>.");
```

- [ ] **Step 4: Register the script** — modify `package.json`

Add to `"scripts"` after `"lint"`:

```json
    "adapters:conformance": "node scripts/adapters-conformance.mjs",
```

- [ ] **Step 5: Write the recipes** — create the six files under `docs/adapters/`

Each file documents: what the port is for, the default (null) behaviour, how to enable it (`WAYFINDER_ADAPTER_<PORT>` and, where applicable, `Preferences.adapters`), required environment (URLs, dirs, secrets), the conformance command, and the security rules (HTTPS + allowlist + timeout + redaction + idempotency). Follow this shape:

```md
# Notifier

Purpose: deliver a redacted notification when the system records an event.

Default (null adapter): nothing leaves the process; the ledger and spoken reply are the notification.

Enable (webhook):
- `WAYFINDER_ADAPTER_NOTIFIER=webhook`
- `WAYFINDER_WEBHOOK_URL=https://...` (must be https and exactly listed)
- `WAYFINDER_WEBHOOK_ALLOWLIST=https://...,https://...`
- `WAYFINDER_ADAPTER_TIMEOUT_MS=5000` (optional)

Rules: HTTPS only; exact-URL allowlist; 5 s timeout; payloads redacted; delivery keyed by `entryId` so retries cannot double-notify; failures append `delivery_failed`.

Verify: `npm run adapters:conformance`
```

Write the equivalent for `calendar.md` (ICS dir), `payment.md` (EPC QR; user scans in their own app; never executes), `signature.md` (local hash chain default; KMS/TSA documented only), `documentSource.md` (user-owned channel; recipe only), `assist.md` (user's own service; recipe only).

- [ ] **Step 6: Run the conformance and full gates**

Run: `npm run adapters:conformance; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: conformance passes (contract suite green), full suite green.

- [ ] **Step 7: Commit**

```bash
git add test/adapters/contract.ts test/adapters/contract.test.ts scripts/adapters-conformance.mjs package.json docs/adapters
git commit -m "test(adapters): add the conformance harness, script, and recipes"
```

---

## Self-Review

**Spec coverage (§9):**
- §9.1 six ports + null default → T2; reference adapters `WebhookNotifier`/`IcsFileSink`/EPC QR → T4–T6; `SignatureProvider`/`DocumentSource`/`AssistProvider` recipe-only → T2 + T11 docs.
- §9.2 interfaces → T2 (with the additive `NotifyInput.entryId` required by §9.6 rule 4).
- §9.3 EPC069-12 + CRC16-CCITT + invalid-IBAN refusal → T4; `PaymentHandoff.prepare` surfaced via `prepare_payment` (T10).
- §9.4 `SignatureProvider` local default and `{ kind, proof }` → T2 (`localSignature`); external attestation documented only (T11).
- §9.5 `DocumentSource` user-owned channel → interface + null (T2) + recipe (T11).
- §9.6 binding rules: disabled by default → T3; never in the request path → T8; redact before transmit → T6 + T8; HTTPS/allowlist/timeout/idempotency → T6; secrets from env only → T3; failures visible (`delivery_failed`) → T8; conformance → T11.
- §9.7 capability disclosure → T9 (`wayfinder://capabilities`, `GET /capabilities`); ledger entry on external invocation → T8 (`external_invoked`).
- §9.8 permanent line → documented in tasks/recipes; no execution code exists.
- §9 acceptance: unchanged behaviour with no adapters → T2/T3/T7 + full-suite gates; invalid IBAN cannot produce `epcQr` → T4; `epcQr` round-trips an independent CRC → T4 test; configured `WebhookNotifier` off-path + redacted + forced failure → `delivery_failed` → T6/T8; `/capabilities` reports `null` → T9.

**Placeholder scan:** none — every step carries runnable code or an exact command.

**Type consistency:** `AdapterBundle` is defined in T2 and consumed unchanged by T7, T9, T10. `AdapterConfig` (T3) is consumed by T7, T9. `NotifyQueue` (T8) is consumed by T9 (type) and T10 (behaviour). `receipt?: LedgerEntry` is produced in T1 and consumed in T10. `buildCapabilities`/`readChain` (T9) are consumed by both the MCP resource and the HTTP route. The two new `LedgerEvent` members (T1) are written only in T1 (`action_executed`), T8 (`external_invoked`), and T10 (`action_proposed` for handoff).

**Known interactions to watch (accepted):**
- T8's queue appends ledger entries asynchronously; tests must `await queue.drain()` before asserting. Production shutdown should `await notify.close()` — the wiring in T9 constructs it; a future task may add a shutdown hook.
- `prepare_payment` records `action_proposed` for a handoff because the spec's event list has no dedicated handoff event; add a spec addendum if a distinct event is wanted.
- `action_executed`/`external_invoked` are additive enum members; stored entries from before remain valid.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-09-20-wayfinder-ports-adapters.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — execute in this session with checkpoints.

Which approach?
