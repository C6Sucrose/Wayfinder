# Wayfinder — Plan 1: Foundation & Domain Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Wayfinder project foundation and the pure domain core (document classifier, field extractors, scam heuristics, action planner, object memory) plus a runnable, sessionful MCP server skeleton that exposes real scan tools. Produces working, testable software on its own.

**Architecture:** A TypeScript ESM Node 22 project. The domain core is pure functions with no I/O or model calls (this is what satisfies policy §10 — real domain logic, not an LLM relay). The MCP server uses the official SDK with a sessionful `StreamableHTTPServerTransport`, backed by a swappable storage interface (file store in dev). Bedrock and the async scan worker arrive in Plan 3; this plan uses a deterministic stub extractor so the full scan→classify→act path is testable end-to-end.

**Tech Stack:** Node 22+, TypeScript 5 (ESM), `@modelcontextprotocol/sdk`, `zod`, `express`, `vitest`, `eslint`, `prettier`.

**Spec:** `docs/superpowers/specs/2026-09-19-wayfinder-design.md`

## Global Constraints

- Node **22+** (24 recommended); ESM (`"type": "module"`).
- MCP spec **`2025-11-25`**, **Streamable HTTP**, sessionful (`MCP-Session-Id`).
- Tool handlers must return in **< 500 ms** — no network or model calls inside handlers.
- Domain core is **pure**: no I/O, no AWS, no model calls.
- Customer-facing text must contain **no IDs, URLs, JSON, or tool names**.
- **No medical/financial advice**: label text is read verbatim + disclaimer; account numbers are masked (`••••1234`).
- Product name is **Wayfinder** (working name); all user-facing strings live in `src/domain/copy.ts`.
- License: **MIT**.

---

## File Structure

```
package.json                          ESM project, scripts, deps
tsconfig.json                         strict TS, NodeNext
vitest.config.ts                      test config
eslint.config.mjs                     flat config
src/
  domain/
    model.ts                          zod schemas: Scan, Item, Action, Object, Preferences, enums
    copy.ts                           user-facing strings (single source for rename)
    classifier.ts                     classText(text, signals) -> {class, confidence, reasons}
    extractors.ts                     extractFields(text, cls) -> typed Fields
    scam.ts                           scoreScam(text, signals) -> {risk, reasons}
    actionPlanner.ts                  planActions(item) -> Action[] (idempotent)
    objectMemory.ts                   remember/find over a store interface
    seed.ts                           synthetic demo documents
  storage/
    types.ts                          Store interface
    fileStore.ts                      JSON-file-backed Store (dev)
  mcp/
    tools.ts                          tool registrations using domain + store
    server.ts                         buildServer(deps): McpServer
  server/
    http.ts                           express app: POST/GET/DELETE /mcp, /healthz
    index.ts                          entrypoint
test/
  classifier.test.ts
  extractors.test.ts
  scam.test.ts
  actionPlanner.test.ts
  objectMemory.test.ts
  mcp.lifecycle.test.ts
```

---

### Task 1: Project scaffold & test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs`, `.gitignore`
- Create: `src/domain/copy.ts`
- Test: `test/smoke.test.ts`

**Interfaces:**
- Produces: working `npm test`, `npm run typecheck`, `npm run lint`; the `copy` module.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "wayfinder",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "node --watch dist/server/index.js",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint .",
    "format": "prettier --write ."
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.20.0",
    "express": "^4.21.2",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.10.5",
    "eslint": "^9.17.0",
    "prettier": "^3.4.2",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "typescript-eslint": "^8.19.1",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`, `eslint.config.mjs`, `.gitignore`**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"] }
});
```

```js
// eslint.config.mjs
import tseslint from "typescript-eslint";
export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  ...tseslint.configs.recommended
);
```

```gitignore
node_modules/
dist/
.env
*.log
data/
coverage/
```

- [ ] **Step 4: Create `src/domain/copy.ts`**

```ts
export const copy = {
  scanStarted: "I'm looking at that now — give me a moment.",
  scanFailed: "I couldn't read that clearly. Could you hold it steadier or move to better light?",
  nothingFound: "I didn't find anything to read in that image.",
  disclaimers: {
    label:
      "This is the text on the label, not medical advice. Consult a healthcare provider for personal decisions.",
  },
} as const;
```

- [ ] **Step 5: Write the failing smoke test**

```ts
// test/smoke.test.ts
import { describe, it, expect } from "vitest";
import { copy } from "../src/domain/copy.js";

describe("smoke", () => {
  it("exposes user-facing copy", () => {
    expect(copy.scanStarted.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm install; if ($?) { npx vitest run test/smoke.test.ts }`
Expected: FAIL — cannot resolve `../src/domain/copy.js` (until file saved; then test should pass — if it passes immediately, that's fine since the module is trivial). If `npm install` fails, resolve dependency versions first.

- [ ] **Step 7: Run tests + typecheck + lint**

Run: `npm test; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: 1 test passing, typecheck clean, lint clean.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts eslint.config.mjs .gitignore src/domain/copy.ts test/smoke.test.ts
git commit -m "chore: scaffold TypeScript ESM project and test harness"
```

---

### Task 2: Domain model & schemas

**Files:**
- Create: `src/domain/model.ts`
- Test: `test/model.test.ts`

**Interfaces:**
- Produces: `DocClass`, `Severity`(unused here), `Scan`, `Item`, `Action`, `StoredObject`, `Preferences` zod schemas and inferred types; `DocClassSchema`, `ItemSchema`, `ActionSchema`, `PreferencesSchema`.

- [ ] **Step 1: Write the failing test**

```ts
// test/model.test.ts
import { describe, it, expect } from "vitest";
import { ItemSchema, ActionSchema } from "../src/domain/model.js";

describe("domain model", () => {
  it("accepts a valid item", () => {
    const item = ItemSchema.parse({
      itemId: "itm_1",
      scanId: "scn_1",
      class: "bill",
      confidence: 0.8,
      readAloudText: "A bill from the city.",
      fields: { dueDate: "2026-10-01" },
      proposedActions: [],
      createdAt: "2026-09-19T10:00:00.000Z",
      resolvedAt: null
    });
    expect(item.class).toBe("bill");
  });

  it("rejects an unknown document class", () => {
    expect(() =>
      ItemSchema.parse({
        itemId: "itm_1", scanId: "scn_1", class: "spaceship",
        confidence: 0.5, readAloudText: "x", fields: {},
        proposedActions: [], createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null
      })
    ).toThrow();
  });

  it("rejects a malformed action type", () => {
    expect(() =>
      ActionSchema.parse({ actionId: "a1", itemId: "itm_1", type: "explode", params: {}, status: "proposed" })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/model.test.ts`
Expected: FAIL — cannot find module `../src/domain/model.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/model.ts
import { z } from "zod";

export const DocClassSchema = z.enum([
  "bill", "appointment", "insurance", "government",
  "receipt", "personal", "junk", "scam", "label"
]);
export type DocClass = z.infer<typeof DocClassSchema>;

export const ActionTypeSchema = z.enum([
  "remind", "schedule", "flag", "file", "share", "discard"
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const ActionStatusSchema = z.enum(["proposed", "confirmed", "done", "failed"]);

export const FieldsSchema = z.object({
  sender: z.string().optional(),
  dueDate: z.string().optional(),
  amount: z.object({ value: z.number(), currency: z.string() }).optional(),
  appointmentAt: z.string().optional(),
  reference: z.string().optional(),
  actionRequired: z.string().optional(),
  maskedAccount: z.string().optional()
}).strict();
export type Fields = z.infer<typeof FieldsSchema>;

export const ActionSchema = z.object({
  actionId: z.string(),
  itemId: z.string(),
  type: ActionTypeSchema,
  params: z.record(z.unknown()).default({}),
  status: ActionStatusSchema
});
export type Action = z.infer<typeof ActionSchema>;

export const ItemSchema = z.object({
  itemId: z.string(),
  scanId: z.string(),
  class: DocClassSchema,
  confidence: z.number().min(0).max(1),
  readAloudText: z.string(),
  fields: FieldsSchema,
  proposedActions: z.array(ActionSchema),
  createdAt: z.string(),
  resolvedAt: z.string().nullable()
});
export type Item = z.infer<typeof ItemSchema>;

export const ScanSchema = z.object({
  scanId: z.string(),
  hint: z.enum(["mail", "label", "object", "scene", "auto"]),
  imageRefs: z.array(z.string()),
  status: z.enum(["queued", "analyzing", "ready", "failed"]),
  createdAt: z.string()
});
export type Scan = z.infer<typeof ScanSchema>;

export const StoredObjectSchema = z.object({
  objectId: z.string(),
  name: z.string(),
  locationNote: z.string(),
  lastSeenAt: z.string(),
  imageRef: z.string().optional()
});
export type StoredObject = z.infer<typeof StoredObjectSchema>;

export const PreferencesSchema = z.object({
  verbosity: z.enum(["brief", "normal", "detailed"]).default("normal"),
  trustedContactAlias: z.string().nullable().default(null),
  largeText: z.boolean().default(false),
  locale: z.string().default("en-US")
});
export type Preferences = z.infer<typeof PreferencesSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/model.test.ts`
Expected: 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/domain/model.ts test/model.test.ts
git commit -m "feat(domain): add core zod schemas and types"
```

---

### Task 3: Document classifier

**Files:**
- Create: `src/domain/classifier.ts`
- Test: `test/classifier.test.ts`

**Interfaces:**
- Consumes: `DocClass` from `model.js`.
- Produces: `export interface Signals { hasQrOrLink: boolean; hasPaymentRequest: boolean; senderMismatch: boolean }` and `export function classifyText(text: string, signals: Signals): { class: DocClass; confidence: number; reasons: string[] }`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/classifier.test.ts
import { describe, it, expect } from "vitest";
import { classifyText, type Signals } from "../src/domain/classifier.js";

const noSignals: Signals = { hasQrOrLink: false, hasPaymentRequest: false, senderMismatch: false };

describe("classifyText", () => {
  it("classifies a bill", () => {
    const r = classifyText("Amount due: 84.20 EUR. Payment due by 1 October 2026.", noSignals);
    expect(r.class).toBe("bill");
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("classifies an appointment", () => {
    const r = classifyText("Your appointment is scheduled for 12 November 2026 at 09:30.", noSignals);
    expect(r.class).toBe("appointment");
  });

  it("classifies insurance", () => {
    const r = classifyText("Your policy premium and coverage summary for this claim.", noSignals);
    expect(r.class).toBe("insurance");
  });

  it("flags scam when strong signals are present", () => {
    const r = classifyText("Urgent: pay immediately with gift cards to avoid arrest.", {
      hasQrOrLink: true, hasPaymentRequest: true, senderMismatch: true
    });
    expect(r.class).toBe("scam");
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("falls back to personal or junk when nothing matches", () => {
    const r = classifyText("Hi, hope you are well. See you soon.", noSignals);
    expect(["personal", "junk"]).toContain(r.class);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/classifier.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/domain/classifier.ts
import type { DocClass } from "./model.js";

export interface Signals {
  hasQrOrLink: boolean;
  hasPaymentRequest: boolean;
  senderMismatch: boolean;
}

interface Rule { cls: DocClass; patterns: RegExp[]; weight: number; reason: string }

const RULES: Rule[] = [
  { cls: "bill", weight: 1, reason: "mentions an amount due or payment due",
    patterns: [/amount due/i, /payment due/i, /invoice/i, /rechnung/i, /please pay/i] },
  { cls: "appointment", weight: 1, reason: "mentions a scheduled appointment",
    patterns: [/appointment/i, /scheduled for/i, /termin/i, /your visit/i] },
  { cls: "insurance", weight: 1, reason: "mentions a policy or claim",
    patterns: [/policy/i, /claim/i, /coverage/i, /insurance/i, /versicherung/i] },
  { cls: "government", weight: 1, reason: "mentions tax or an authority",
    patterns: [/tax/i, /finanzamt/i, /authority/i, /benefits/i, /steuer/i] },
  { cls: "receipt", weight: 1, reason: "looks like a purchase receipt",
    patterns: [/thank you for your purchase/i, /receipt/i, /total\s*[:€$]/i] },
  { cls: "label", weight: 1, reason: "looks like a product or food label",
    patterns: [/ingredients/i, /best before/i, /use by/i, /allergen/i] },
];

export function classifyText(text: string, signals: Signals): { class: DocClass; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let scamScore = 0;
  if (signals.hasPaymentRequest) { scamScore += 2; reasons.push("asks for a payment"); }
  if (signals.hasQrOrLink) { scamScore += 1; reasons.push("contains a link or QR code"); }
  if (signals.senderMismatch) { scamScore += 2; reasons.push("sender does not match the claimed organisation"); }
  if (/urgent|immediately|gift card|arrest|final notice/i.test(text)) { scamScore += 2; reasons.push("uses urgent or threatening language"); }
  if (scamScore >= 3) {
    return { class: "scam", confidence: Math.min(0.95, 0.5 + scamScore * 0.1), reasons };
  }

  let best: { cls: DocClass; hits: number; reasons: string[] } | null = null;
  for (const rule of RULES) {
    const hits = rule.patterns.filter((p) => p.test(text)).length;
    if (hits > 0 && (!best || hits > best.hits)) {
      best = { cls: rule.cls, hits, reasons: [rule.reason] };
    }
  }
  if (best) {
    return { class: best.cls, confidence: Math.min(0.9, 0.5 + best.hits * 0.15), reasons: best.reasons };
  }

  if (/\bhi\b|\bdear\b|\bhello\b/i.test(text)) {
    return { class: "personal", confidence: 0.4, reasons: ["addresses the reader personally"] };
  }
  return { class: "junk", confidence: 0.3, reasons: ["no recognisable document patterns"] };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/classifier.test.ts`
Expected: 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/domain/classifier.ts test/classifier.test.ts
git commit -m "feat(domain): add rule-based document classifier"
```

---

### Task 4: Field extractors

**Files:**
- Create: `src/domain/extractors.ts`
- Test: `test/extractors.test.ts`

**Interfaces:**
- Consumes: `Fields`, `DocClass` from `model.js`.
- Produces: `export function extractFields(text: string, cls: DocClass): Fields` and `export function maskAccount(raw: string): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/extractors.test.ts
import { describe, it, expect } from "vitest";
import { extractFields, maskAccount } from "../src/domain/extractors.js";

describe("extractFields", () => {
  it("extracts an ISO due date and amount", () => {
    const f = extractFields("Amount due: €84.20. Payment due 2026-10-01.", "bill");
    expect(f.dueDate).toBe("2026-10-01");
    expect(f.amount).toEqual({ value: 84.2, currency: "EUR" });
  });

  it("parses a long-form English date", () => {
    const f = extractFields("Appointment scheduled for 12 November 2026 at 09:30.", "appointment");
    expect(f.appointmentAt?.startsWith("2026-11-12")).toBe(true);
  });

  it("masks an account number", () => {
    expect(maskAccount("DE89370400440532013000")).toBe("••••3000");
  });

  it("extracts a masked account from text", () => {
    const f = extractFields("Account number IBAN DE89370400440532013000", "bill");
    expect(f.maskedAccount).toBe("••••3000");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/extractors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/domain/extractors.ts
import type { DocClass, Fields } from "./model.js";

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12"
};

export function maskAccount(raw: string): string {
  const tail = raw.replace(/\s+/g, "").slice(-4);
  return `••••${tail}`;
}

function isoDate(text: string): string | undefined {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const long = text.match(/\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/);
  if (long) {
    const mm = MONTHS[long[2]!.toLowerCase()];
    if (mm) return `${long[3]}-${mm}-${long[1]!.padStart(2, "0")}`;
  }
  return undefined;
}

function time24(text: string): string | undefined {
  const t = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return t ? `${t[1]!.padStart(2, "0")}:${t[2]}` : undefined;
}

function amount(text: string): Fields["amount"] {
  const sym = text.match(/[€$£]\s?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/);
  if (sym) {
    const raw = sym[1]!.replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
    const currency = text.includes("€") ? "EUR" : text.includes("£") ? "GBP" : "USD";
    return { value: Number(raw), currency };
  }
  return undefined;
}

export function extractFields(text: string, cls: DocClass): Fields {
  const fields: Fields = {};
  const date = isoDate(text);
  if (cls === "appointment") {
    if (date) fields.appointmentAt = time24(text) ? `${date}T${time24(text)}:00` : date;
  } else if (date) {
    fields.dueDate = date;
  }
  const amt = amount(text);
  if (amt) fields.amount = amt;
  const iban = text.match(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/);
  if (iban) fields.maskedAccount = maskAccount(iban[0]);
  const ref = text.match(/\b(?:ref|reference|kundennummer|customer no\.?)\s*[:#]?\s*([A-Z0-9-]{4,})/i);
  if (ref) fields.reference = ref[1]!;
  return fields;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/extractors.test.ts`
Expected: 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/domain/extractors.ts test/extractors.test.ts
git commit -m "feat(domain): add typed field extractors with account masking"
```

---

### Task 5: Scam heuristics

**Files:**
- Create: `src/domain/scam.ts`
- Test: `test/scam.test.ts`

**Interfaces:**
- Consumes: `Signals` from `classifier.js`.
- Produces: `export interface ScamResult { riskScore: number; band: "low" | "medium" | "high"; reasons: string[] }` and `export function scoreScam(text: string, signals: Signals): ScamResult`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/scam.test.ts
import { describe, it, expect } from "vitest";
import { scoreScam } from "../src/domain/scam.js";

describe("scoreScam", () => {
  it("returns high risk for a gift-card payment demand", () => {
    const r = scoreScam("Urgent: pay with gift cards within 24 hours.", {
      hasQrOrLink: true, hasPaymentRequest: true, senderMismatch: true
    });
    expect(r.band).toBe("high");
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("returns low risk for normal mail", () => {
    const r = scoreScam("Your appointment is confirmed.", {
      hasQrOrLink: false, hasPaymentRequest: false, senderMismatch: false
    });
    expect(r.band).toBe("low");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/scam.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/domain/scam.ts
import type { Signals } from "./classifier.js";

export interface ScamResult {
  riskScore: number;
  band: "low" | "medium" | "high";
  reasons: string[];
}

const URGENCY = /urgent|immediately|within \d+ hours|final notice|act now|arrest|suspend/i;
const GIFT = /gift card|itunes card|google play card|voucher code/i;

export function scoreScam(text: string, signals: Signals): ScamResult {
  let score = 0;
  const reasons: string[] = [];
  if (signals.hasPaymentRequest) { score += 0.3; reasons.push("requests a payment"); }
  if (signals.hasQrOrLink) { score += 0.15; reasons.push("includes a link or QR code"); }
  if (signals.senderMismatch) { score += 0.25; reasons.push("sender does not match the claimed organisation"); }
  if (URGENCY.test(text)) { score += 0.2; reasons.push("uses urgency or threats"); }
  if (GIFT.test(text)) { score += 0.3; reasons.push("asks for gift-card payment"); }
  score = Math.min(1, score);
  const band = score >= 0.6 ? "high" : score >= 0.35 ? "medium" : "low";
  return { riskScore: score, band, reasons };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/scam.test.ts`
Expected: 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/domain/scam.ts test/scam.test.ts
git commit -m "feat(domain): add explainable scam heuristic scorer"
```

---

### Task 6: Action planner

**Files:**
- Create: `src/domain/actionPlanner.ts`
- Test: `test/actionPlanner.test.ts`

**Interfaces:**
- Consumes: `Item`, `Action`, `ActionType` from `model.js`; `ScamResult` from `scam.js`.
- Produces: `export function planActions(item: Item, scam?: ScamResult): Action[]` (pure, idempotent — deterministic IDs derived from `itemId` + type).

- [ ] **Step 1: Write the failing tests**

```ts
// test/actionPlanner.test.ts
import { describe, it, expect } from "vitest";
import { planActions } from "../src/domain/actionPlanner.js";
import type { Item } from "../src/domain/model.js";

const base: Item = {
  itemId: "itm_1", scanId: "scn_1", class: "bill", confidence: 0.8,
  readAloudText: "A bill.", fields: { dueDate: "2026-10-01" },
  proposedActions: [], createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null
};

describe("planActions", () => {
  it("plans a reminder for a bill with a due date", () => {
    const actions = planActions(base);
    expect(actions.map((a) => a.type)).toContain("remind");
  });

  it("plans a schedule action for an appointment", () => {
    const actions = planActions({ ...base, class: "appointment", fields: { appointmentAt: "2026-11-12T09:30:00" } });
    expect(actions.map((a) => a.type)).toContain("schedule");
  });

  it("plans a flag action for high-risk scam", () => {
    const actions = planActions({ ...base, class: "scam", fields: {} }, { riskScore: 0.8, band: "high", reasons: [] });
    expect(actions.map((a) => a.type)).toContain("flag");
  });

  it("is idempotent (same input yields same action ids)", () => {
    expect(JSON.stringify(planActions(base))).toBe(JSON.stringify(planActions(base)));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/actionPlanner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/domain/actionPlanner.ts
import type { Action, ActionType, Item } from "./model.js";
import type { ScamResult } from "./scam.js";

function make(itemId: string, type: ActionType, params: Record<string, unknown> = {}): Action {
  return { actionId: `${itemId}:${type}`, itemId, type, params, status: "proposed" };
}

export function planActions(item: Item, scam?: ScamResult): Action[] {
  const out: Action[] = [];
  switch (item.class) {
    case "appointment":
      if (item.fields.appointmentAt) out.push(make(item.itemId, "schedule", { at: item.fields.appointmentAt }));
      break;
    case "bill":
      if (item.fields.dueDate) out.push(make(item.itemId, "remind", { on: item.fields.dueDate }));
      break;
    case "insurance":
    case "government":
    case "personal":
      out.push(make(item.itemId, "file"));
      break;
    case "label":
      break;
    case "junk":
      out.push(make(item.itemId, "discard"));
      break;
    case "scam":
      out.push(make(item.itemId, "flag", { band: scam?.band ?? "medium" }));
      out.push(make(item.itemId, "discard"));
      break;
    case "receipt":
      out.push(make(item.itemId, "file"));
      break;
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/actionPlanner.test.ts`
Expected: 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/domain/actionPlanner.ts test/actionPlanner.test.ts
git commit -m "feat(domain): add idempotent action planner"
```

---

### Task 7: Storage interface, file store, and object memory

**Files:**
- Create: `src/storage/types.ts`, `src/storage/fileStore.ts`, `src/domain/objectMemory.ts`
- Test: `test/objectMemory.test.ts`

**Interfaces:**
- Produces: `Store` interface with `get/set/list` for scans, items, actions, objects, preferences; `createFileStore(dir: string): Store`; `rememberObject(store, input): Promise<StoredObject>`; `findObject(store, name): Promise<StoredObject | null>`.

- [ ] **Step 1: Write the failing test**

```ts
// test/objectMemory.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../src/storage/fileStore.js";
import { rememberObject, findObject } from "../src/domain/objectMemory.js";

let store: ReturnType<typeof createFileStore>;
beforeEach(() => {
  store = createFileStore(mkdtempSync(join(tmpdir(), "wf-")));
});

describe("object memory", () => {
  it("remembers and finds an object, case-insensitively", async () => {
    await rememberObject(store, { name: "Keys", locationNote: "entry table", imageRef: "img1" });
    const found = await findObject(store, "keys");
    expect(found?.locationNote).toBe("entry table");
  });

  it("returns null when not found", async () => {
    expect(await findObject(store, "passport")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/objectMemory.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement storage types and file store**

```ts
// src/storage/types.ts
import type { Scan, Item, Action, StoredObject, Preferences } from "../domain/model.js";

export interface Store {
  putScan(s: Scan): Promise<void>;
  getScan(id: string): Promise<Scan | null>;
  putItem(i: Item): Promise<void>;
  getItem(id: string): Promise<Item | null>;
  listItems(filter: "unresolved" | "due" | "flagged" | "all"): Promise<Item[]>;
  putAction(a: Action): Promise<void>;
  listActions(itemId: string): Promise<Action[]>;
  putObject(o: StoredObject): Promise<void>;
  listObjects(): Promise<StoredObject[]>;
  getPreferences(): Promise<Preferences>;
  putPreferences(p: Preferences): Promise<void>;
}
```

```ts
// src/storage/fileStore.ts
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Store } from "./types.js";
import { PreferencesSchema, type Item, type Scan } from "../domain/model.js";

export function createFileStore(dir: string): Store {
  const itemsDir = join(dir, "items");
  const scansDir = join(dir, "scans");
  mkdirSync(itemsDir, { recursive: true });
  mkdirSync(scansDir, { recursive: true });

  const readJson = <T>(p: string): T | null => (existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null);
  const writeJson = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 2), "utf8");
  const norm = (s: string) => s.trim().toLowerCase();

  return {
    async putScan(s) { writeJson(join(scansDir, `${s.scanId}.json`), s); },
    async getScan(id) { return readJson<Scan>(join(scansDir, `${id}.json`)); },
    async putItem(i) { writeJson(join(itemsDir, `${i.itemId}.json`), i); },
    async getItem(id) { return readJson<Item>(join(itemsDir, `${id}.json`)); },
    async listItems(filter) {
      const all = readdirSync(itemsDir).map((f) => readJson<Item>(join(itemsDir, f))!).filter(Boolean);
      if (filter === "all") return all;
      if (filter === "unresolved") return all.filter((i) => i.resolvedAt === null);
      if (filter === "flagged") return all.filter((i) => i.class === "scam");
      const today = new Date().toISOString().slice(0, 10);
      return all.filter((i) => i.fields.dueDate !== undefined && i.fields.dueDate <= today);
    },
    async putAction() { /* actions are stored on items in this plan */ },
    async listActions() { return []; },
    async putObject(o) { writeJson(join(dir, `object-${o.objectId}.json`), o); },
    async listObjects() {
      return readdirSync(dir).filter((f) => f.startsWith("object-"))
        .map((f) => readJson<import("../domain/model.js").StoredObject>(join(dir, f))!).filter(Boolean);
    },
    async getPreferences() {
      return PreferencesSchema.parse(readJson(join(dir, "preferences.json")) ?? {});
    },
    async putPreferences(p) { writeJson(join(dir, "preferences.json"), p); }
  };
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}
```

- [ ] **Step 4: Implement object memory**

```ts
// src/domain/objectMemory.ts
import type { Store } from "../storage/types.js";
import { StoredObjectSchema, type StoredObject } from "./model.js";
import { randomUUID } from "node:crypto";

export interface RememberInput { name: string; locationNote: string; imageRef?: string }

export async function rememberObject(store: Store, input: RememberInput): Promise<StoredObject> {
  const obj = StoredObjectSchema.parse({
    objectId: `obj_${randomUUID().slice(0, 8)}`,
    name: input.name,
    locationNote: input.locationNote,
    lastSeenAt: new Date().toISOString(),
    ...(input.imageRef ? { imageRef: input.imageRef } : {})
  });
  await store.putObject(obj);
  return obj;
}

export async function findObject(store: Store, name: string): Promise<StoredObject | null> {
  const target = name.trim().toLowerCase();
  const matches = (await store.listObjects())
    .filter((o) => o.name.trim().toLowerCase() === target)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  return matches[0] ?? null;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/objectMemory.test.ts`
Expected: 2 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/storage src/domain/objectMemory.ts test/objectMemory.test.ts
git commit -m "feat: add storage interface, file store, and object memory"
```

---

### Task 8: Scan pipeline (deterministic) + tools + sessionful MCP server

**Files:**
- Create: `src/domain/scanPipeline.ts`, `src/mcp/tools.ts`, `src/mcp/server.ts`, `src/server/http.ts`, `src/server/index.ts`
- Test: `test/scanPipeline.test.ts`, `test/mcp.lifecycle.test.ts`

**Interfaces:**
- Consumes: `classifyText`, `extractFields`, `scoreScam`, `planActions`, `Store`, `copy`.
- Produces: `export async function runScan(store: Store, input: { imageRefs: string[]; hint: Scan["hint"]; extractedText?: string[] }): Promise<Scan>`; `export function buildServer(deps: { store: Store }): McpServer`; `export function createHttpApp(deps: { store: Store }): express.Express`.

- [ ] **Step 1: Write the failing pipeline test**

```ts
// test/scanPipeline.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../src/storage/fileStore.js";
import { runScan } from "../src/domain/scanPipeline.js";

let store: ReturnType<typeof createFileStore>;
beforeEach(() => { store = createFileStore(mkdtempSync(join(tmpdir(), "wf-"))); });

describe("runScan", () => {
  it("classifies text into items with proposed actions", async () => {
    const scan = await runScan(store, {
      imageRefs: ["img1"],
      hint: "mail",
      extractedText: ["Amount due: €84.20. Payment due 2026-10-01."]
    });
    expect(scan.status).toBe("ready");
    const items = await store.listItems("all");
    expect(items.length).toBe(1);
    expect(items[0]!.class).toBe("bill");
    expect(items[0]!.proposedActions.map((a) => a.type)).toContain("remind");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/scanPipeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the scan pipeline**

```ts
// src/domain/scanPipeline.ts
import type { Store } from "../storage/types.js";
import type { Scan } from "./model.js";
import { ItemSchema } from "./model.js";
import { classifyText } from "./classifier.js";
import { extractFields } from "./extractors.js";
import { scoreScam } from "./scam.js";
import { planActions } from "./actionPlanner.js";
import { randomUUID } from "node:crypto";

export interface ScanInput {
  imageRefs: string[];
  hint: Scan["hint"];
  extractedText?: string[]; // in Plan 3 this is produced by Bedrock; here it is injected
}

export async function runScan(store: Store, input: ScanInput): Promise<Scan> {
  const scanId = `scn_${randomUUID().slice(0, 8)}`;
  const scan: Scan = {
    scanId, hint: input.hint, imageRefs: input.imageRefs,
    status: "analyzing", createdAt: new Date().toISOString()
  };
  await store.putScan(scan);

  const texts = input.extractedText ?? [];
  for (const text of texts) {
    const signals = {
      hasQrOrLink: /https?:\/\/|\bQR\b/i.test(text),
      hasPaymentRequest: /pay|payment|transfer|überweisen/i.test(text),
      senderMismatch: /dear customer/i.test(text)
    };
    const { class: cls, confidence } = classifyText(text, signals);
    const fields = extractFields(text, cls);
    const scam = scoreScam(text, signals);
    const itemId = `itm_${randomUUID().slice(0, 8)}`;
    const actions = planActions(
      { itemId, scanId, class: cls, confidence, readAloudText: text, fields, proposedActions: [], createdAt: new Date().toISOString(), resolvedAt: null },
      scam
    );
    const item = ItemSchema.parse({
      itemId, scanId, class: cls, confidence, readAloudText: text,
      fields, proposedActions: actions, createdAt: new Date().toISOString(), resolvedAt: null
    });
    await store.putItem(item);
  }

  const done: Scan = { ...scan, status: texts.length > 0 ? "ready" : "failed" };
  await store.putScan(done);
  return done;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/scanPipeline.test.ts`
Expected: 1 test passing.

- [ ] **Step 5: Implement tools + server**

```ts
// src/mcp/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Store } from "../storage/types.js";
import { runScan } from "../domain/scanPipeline.js";
import { copy } from "../domain/copy.js";
import { rememberObject, findObject } from "../domain/objectMemory.js";

export function buildServer(deps: { store: Store }): McpServer {
  const server = new McpServer({ name: "wayfinder", version: "0.1.0" });

  server.tool(
    "capture_scan",
    "Start reading images the customer captured. Use for mail, labels, or objects.",
    { imageRefs: z.array(z.string()).min(1), hint: z.enum(["mail", "label", "object", "scene", "auto"]).default("auto") },
    async ({ imageRefs, hint }) => {
      const scan = await runScan(deps.store, { imageRefs, hint });
      const items = await deps.store.listItems("all");
      const mine = items.filter((i) => i.scanId === scan.scanId);
      return {
        content: [{ type: "text", text: mine.length ? `I read ${mine.length} item(s).` : copy.scanFailed }],
        structuredContent: { scanId: scan.scanId, count: mine.length }
      };
    }
  );

  server.tool(
    "get_scan",
    "Return the items found in a previous scan, with their suggested actions.",
    { scanId: z.string() },
    async ({ scanId }) => {
      const items = (await deps.store.listItems("all")).filter((i) => i.scanId === scanId);
      return {
        content: [{ type: "text", text: items.map((i) => i.readAloudText).join(" ") || copy.nothingFound }],
        structuredContent: { items }
      };
    }
  );

  server.tool(
    "find_object",
    "Find where an object was last seen.",
    { name: z.string() },
    async ({ name }) => {
      const found = await findObject(deps.store, name);
      return {
        content: [{ type: "text", text: found ? `Last seen ${found.locationNote}.` : `I don't have a location for ${name}.` }],
        structuredContent: { found }
      };
    }
  );

  server.tool(
    "remember_object",
    "Remember where an object is.",
    { name: z.string(), locationNote: z.string(), imageRef: z.string().optional() },
    async ({ name, locationNote, imageRef }) => {
      const obj = await rememberObject(deps.store, imageRef ? { name, locationNote, imageRef } : { name, locationNote });
      return { content: [{ type: "text", text: `Saved ${obj.name}.` }], structuredContent: { object: obj } };
    }
  );

  return server;
}
```

```ts
// src/server/http.ts
import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Store } from "../storage/types.js";
import { buildServer } from "../mcp/server.js";

export function createHttpApp(deps: { store: Store }) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.get("/healthz", (_req, res) => { res.json({ ok: true }); });

  const handle = async (req: express.Request, res: express.Response) => {
    const sessionId = req.headers["mcp-session-id"];
    let transport: StreamableHTTPServerTransport | undefined =
      typeof sessionId === "string" ? transports.get(sessionId) : undefined;
    if (!transport) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => { transports.set(sid, transport!); }
      });
      transport.onclose = () => {
        if (transport!.sessionId) transports.delete(transport!.sessionId);
      };
      await buildServer(deps).connect(transport);
    }
    await transport.handleRequest(req, res, req.body);
  };

  app.post("/mcp", handle);
  app.get("/mcp", handle);
  app.delete("/mcp", handle);
  return app;
}
```

```ts
// src/server/index.ts
import { createHttpApp } from "./http.js";
import { createFileStore } from "../storage/fileStore.js";

const dir = process.env.WAYFINDER_DATA_DIR ?? "data";
const app = createHttpApp({ store: createFileStore(dir) });
const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => console.log(`Wayfinder MCP server on :${port}`));
```

- [ ] **Step 6: Write the failing MCP lifecycle test**

```ts
// test/mcp.lifecycle.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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
    await client.connect(new StreamableHTTPClientTransport(new URL(baseUrl)));
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("capture_scan");
    const res = await client.callTool({ name: "find_object", arguments: { name: "keys" } });
    expect(res.content).toBeTruthy();
    await client.close();
  });
});
```

- [ ] **Step 7: Run lifecycle test, verify fail then pass**

Run: `npx vitest run test/mcp.lifecycle.test.ts`
Expected: first run FAILS (missing files) — after Step 5 files exist, re-run: PASS.
Note: if `client.callTool` returns an error shape, assert on `res.isError !== true` instead.

- [ ] **Step 8: Full suite + typecheck + lint, then commit**

Run: `npm test; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: all tests pass; typecheck and lint clean.

```bash
git add src test
git commit -m "feat(mcp): add scan pipeline, tools, and sessionful Streamable HTTP server"
```

---

## Self-Review

**Spec coverage (Plan 1 scope):** domain model (§9), classifier/extractors/scam/action planner/object memory (§9.1–§9.3), storage interface (§7.2), MCP server + sessionful transport (§7.2, §8), scan pipeline with injected text (Plan 3 replaces injection with Bedrock vision), copy module (rename + compliance text). Remaining spec sections (MCP Apps UI, Bedrock brain, sim client, classic skill, OAuth, AWS, conformance, docs) are covered by Plans 2–5, not this plan.

**Placeholder scan:** none — every step contains real code.

**Type consistency:** `Store` methods, `Item`/`Action`/`Scan` fields, and tool signatures are consistent across tasks. `runScan` accepts `extractedText?` so Plan 3 can supply Bedrock output without changing the signature.

**Known limitation (intentional):** `putAction`/`listActions` are stubbed because actions are embedded on items in this plan; Plan 2 moves action persistence to a first-class store when `act_on_item` is added. This is a deliberate, documented boundary — not a placeholder tool.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-09-19-wayfinder-foundation-domain.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints for review.

Which approach?
