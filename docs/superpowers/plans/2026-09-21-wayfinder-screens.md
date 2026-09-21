# Wayfinder Screens Implementation Plan (Plan 8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four MCP App screens from spec §5.3 — backlog, audit/history, verification badge, and a refusal card with an escalate affordance — to the existing single-bundle View.

**Architecture:** The product ships one MCP App resource (`ui://wayfinder/app.html`) whose bundle switches on the invoking tool name in `renderScreen(input)`. There is no per-screen resource. To make a tool render, the server must register it with `registerAppTool` + `_meta.ui.resourceUri`, list it in `UI_TOOLS`, and `ui/src/screens.ts` must have a matching `case`. This plan promotes `get_backlog`, `get_audit`, `verify_ledger`, and `act_on_item` to app tools, adds four render branches plus a small escalation flow, and extends two structured-content payloads so the refusal card has a reason and the escalate confirmation has a contact alias.

**Tech Stack:** TypeScript (ESM, Node ≥ 22), `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps` (1.x), Zod, Vitest, esbuild (`ui/build.mjs`), plain DOM (no framework) in the View.

**Spec:** `docs/superpowers/specs/2026-09-20-wayfinder-v2-verifiable-agency.md` (§5.3 Resources & UI; §3 data model; §2.2/§2.3 for the ledger and refusal semantics)

## Global Constraints

- Node `>=22`; ESM (`"type": "module"`); relative imports carry the `.js` extension (NodeNext).
- `tsconfig` is `strict` with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` — add optional properties conditionally (`...(x !== undefined ? { x } : {})`), never as `undefined`.
- **No new dependencies.** `package.json` is not touched.
- **Do not add code comments.**
- The MCP App View bundle (`ui/`) must not import server or `src/domain` code. User-facing View strings stay as inline literals, matching the existing screens (the View intentionally cannot reach `src/domain/copy.ts`).
- Every value interpolated into HTML in `ui/src/screens.ts` passes through the existing `escape()` helper. Item/thread/ledger fields are attacker-influenced and must be escaped.
- Screens are read-only presentation. Tool handlers perform no network I/O and stay within the < 500 ms handler budget.
- The `<500 ms` rule and all adapter/ledger behaviour are unchanged. Ledger `details` redaction is untouched.
- Gate for every task: `npm test` (its `pretest` builds `dist/ui/app.html`), `npm run typecheck` (checks both the server and `ui/tsconfig.json`), `npm run lint`. All must be green before committing.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `ui/src/screens.ts` | Pure `renderScreen`/`renderConfirm` HTML for every screen | Add four branches + helpers |
| `ui/src/styles.css` | Inlined View styles | Add `.meta`, `.timeline*`, `.badge*`, `.refusal` |
| `ui/src/main.ts` | View bootstrap, host-context wiring, tool calls | Pass `confirmed`, add escalate wiring |
| `src/mcp/appResource.ts` | `APP_RESOURCE_URI` + `UI_TOOLS` | Add the four promoted tool names |
| `src/mcp/server.ts` | Tool/resource registration | Promote four tools to `registerAppTool`; extend two payloads |
| `test/screens.test.ts` | Pure screen rendering tests | Add the four new screen suites |
| `test/governedTools.test.ts` | Tool `structuredContent` tests | Assert the refusal reason and escalate alias |

Task order: Task 1 → 2 → 3 each add one read-only screen. Task 4 adds the refusal/escalation flow and is independent of 2 and 3 but shares the `UI_TOOLS` edit with Task 1; do it last.

---

### Task 1: Backlog screen

**Files:**
- Modify: `src/mcp/appResource.ts:4-6`
- Modify: `src/mcp/server.ts:254-274` (the `get_backlog` registration)
- Modify: `ui/src/screens.ts` (add `threadCard` helper and a `case`)
- Modify: `ui/src/styles.css` (add `.meta`)
- Test: `test/screens.test.ts`

**Interfaces:**
- Consumes: `BacklogEntry` `{ thread: Thread; documents: DocumentRecord[]; deadline?: string }` (`src/domain/backlog.ts:5-9`); `Thread` `{ threadKey, sender, demandType, documentIds, firstSeenAt, lastSeenAt, reminderCount, urgency: "low"|"medium"|"high", outstanding }` (`src/domain/model.ts:139-150`). The `get_backlog` tool returns `structuredContent: { backlog: BacklogEntry[] }`.
- Produces: `threadCard(entry: Record<string, unknown>): string`; a `case "get_backlog"` branch in `renderScreen`.

- [ ] **Step 1: Write the failing tests**

Add to `test/screens.test.ts` (after the `daily_briefing` describe block):

```ts
describe("renderScreen: get_backlog", () => {
  const entry = {
    thread: {
      threadKey: "t1",
      sender: "City Water",
      demandType: "payment",
      documentIds: ["d1", "d2"],
      firstSeenAt: "2026-09-01T00:00:00.000Z",
      lastSeenAt: "2026-09-18T00:00:00.000Z",
      reminderCount: 2,
      urgency: "high",
      outstanding: true
    },
    documents: [{ itemId: "d1" }, { itemId: "d2" }],
    deadline: "2026-09-22"
  };

  it("renders each thread with sender, demand, urgency, reminders, and deadline", () => {
    const html = renderScreen({ toolName: "get_backlog", arguments: {}, result: { backlog: [entry] } });
    expect(html).toContain('<section class="grid">');
    expect(html).toContain("City Water · payment");
    expect(html).toContain("high urgency");
    expect(html).toContain("due 2026-09-22");
    expect(html).toContain("2 reminder(s)");
    expect(html).toContain("2 document(s)");
    expect(html).toContain("card--alert");
  });

  it("treats a missing demand type as a document and gives low urgency no tone", () => {
    const quiet = {
      thread: { sender: "Council", demandType: "none", urgency: "low", reminderCount: 0 },
      documents: []
    };
    const html = renderScreen({ toolName: "get_backlog", arguments: {}, result: { backlog: [quiet] } });
    expect(html).toContain("Council · document");
    expect(html).toContain("low urgency");
    expect(html).not.toContain("card--alert");
    expect(html).not.toContain("card--info");
  });

  it("escapes hostile thread text", () => {
    const hostile = {
      thread: { sender: "<img src=x onerror=alert(1)>", demandType: "payment", urgency: "medium", reminderCount: 0 },
      documents: []
    };
    const html = renderScreen({ toolName: "get_backlog", arguments: {}, result: { backlog: [hostile] } });
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
  });

  it("renders an empty state when there is no backlog", () => {
    expect(renderScreen({ toolName: "get_backlog", arguments: {}, result: { backlog: [] } })).toBe(
      '<p class="empty">Nothing is waiting on you right now.</p>'
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/screens.test.ts`
Expected: FAIL — the `get_backlog` cases fall through to `default` and render `Nothing to show yet.`

- [ ] **Step 3: Render the backlog**

In `ui/src/screens.ts`, add this helper after `itemCard` (before `renderConfirm`):

```ts
function threadCard(entry: Record<string, unknown>): string {
  const thread = (entry.thread ?? {}) as Record<string, unknown>;
  const urgency = String(thread.urgency ?? "low");
  const tone = urgency === "high" ? "alert" : urgency === "medium" ? "info" : "";
  const sender = thread.sender ? String(thread.sender) : "Unknown sender";
  const demand = thread.demandType && thread.demandType !== "none" ? String(thread.demandType) : "document";
  const reminders = Number(thread.reminderCount ?? 0);
  const documents = Array.isArray(entry.documents) ? entry.documents.length : 0;
  const parts = [`${urgency} urgency`];
  if (entry.deadline) parts.push(`due ${String(entry.deadline)}`);
  if (reminders > 0) parts.push(`${reminders} reminder(s)`);
  parts.push(`${documents} document(s)`);
  return card(`${sender} · ${demand}`, `<p class="meta">${escape(parts.join(" · "))}</p>`, tone);
}
```

In `renderScreen`, add this `case` immediately before `case "daily_briefing":`:

```ts
    case "get_backlog": {
      const backlog = Array.isArray(result.backlog) ? (result.backlog as Array<Record<string, unknown>>) : [];
      return backlog.length
        ? `<section class="grid">${backlog.map(threadCard).join("")}</section>`
        : `<p class="empty">Nothing is waiting on you right now.</p>`;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/screens.test.ts`
Expected: PASS

- [ ] **Step 5: Make `get_backlog` an app tool**

In `src/mcp/appResource.ts`, add `"get_backlog"` to the array:

```ts
export const UI_TOOLS = [
  "get_scan", "list_items", "get_item", "daily_briefing", "identify_product", "find_object", "get_backlog"
] as const;
```

In `src/mcp/server.ts`, replace the `get_backlog` registration header (lines 254-258):

```ts
  server.tool(
    "get_backlog",
    "Rank what needs attention by urgency, with outstanding demands and related documents.",
    { date: z.string().optional() },
    async ({ date }) => {
```

with:

```ts
  registerAppTool(
    server,
    "get_backlog",
    {
      description: "Rank what needs attention by urgency, with outstanding demands and related documents.",
      inputSchema: { date: z.string().optional() },
      _meta: { ui: { resourceUri: APP_RESOURCE_URI } }
    },
    async ({ date }) => {
```

(The handler body and the closing `);` are unchanged.)

- [ ] **Step 6: Add the `.meta` style**

In `ui/src/styles.css`, append:

```css
.meta { color: var(--wf-muted); margin: 0; }
```

- [ ] **Step 7: Run the gates**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass. `test/uiMeta.test.ts` now also verifies `get_backlog` carries `_meta.ui.resourceUri`.

- [ ] **Step 8: Commit**

```bash
git add src/mcp/appResource.ts src/mcp/server.ts ui/src/screens.ts ui/src/styles.css test/screens.test.ts
git commit -m "feat(ui): add the backlog screen"
```

---

### Task 2: Audit / history screen

**Files:**
- Modify: `src/mcp/appResource.ts:4-6`
- Modify: `src/mcp/server.ts:276-296` (the `get_audit` registration)
- Modify: `ui/src/screens.ts` (add `entryRow` helper and a `case`)
- Modify: `ui/src/styles.css` (add `.timeline*`)
- Test: `test/screens.test.ts`

**Interfaces:**
- Consumes: `LedgerEntry` `{ seq: number; entryId; at; actor: "agent"|"user"; event: LedgerEvent; documentId?; threadKey?; details; prevHash; hash }` (`src/domain/model.ts:125-137`). The `get_audit` tool returns `structuredContent: { entries: LedgerEntry[] }`.
- Produces: `entryRow(entry: Record<string, unknown>): string`; a `case "get_audit"` branch in `renderScreen`.

- [ ] **Step 1: Write the failing tests**

Add to `test/screens.test.ts`:

```ts
describe("renderScreen: get_audit", () => {
  const entries = [
    { seq: 1, at: "2026-09-20T12:00:00.000Z", actor: "agent", event: "ingested" },
    { seq: 2, at: "2026-09-20T12:01:00.000Z", actor: "user", event: "action_confirmed" }
  ];

  it("renders an event timeline with sequence, time, and actor", () => {
    const html = renderScreen({ toolName: "get_audit", arguments: {}, result: { entries } });
    expect(html).toContain('<ol class="timeline">');
    expect(html).toContain("ingested");
    expect(html).toContain("action_confirmed");
    expect(html).toContain("#1");
    expect(html).toContain("user");
  });

  it("escapes hostile event text", () => {
    const html = renderScreen({
      toolName: "get_audit",
      arguments: {},
      result: { entries: [{ seq: 1, event: "<script>alert(1)</script>" }] }
    });
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("renders an empty state with no history", () => {
    expect(renderScreen({ toolName: "get_audit", arguments: {}, result: { entries: [] } })).toBe(
      '<p class="empty">I have no record of that.</p>'
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/screens.test.ts`
Expected: FAIL — `get_audit` falls through to `default`.

- [ ] **Step 3: Render the audit timeline**

In `ui/src/screens.ts`, add after `threadCard`:

```ts
function entryRow(entry: Record<string, unknown>): string {
  const event = String(entry.event ?? "event");
  const seq = entry.seq !== undefined ? `#${escape(entry.seq)} ` : "";
  const meta = [String(entry.at ?? ""), String(entry.actor ?? "")].filter(Boolean).join(" · ");
  return `<li class="timeline__item"><span class="timeline__event">${escape(event)}</span><span class="timeline__meta">${seq}${escape(meta)}</span></li>`;
}
```

In `renderScreen`, add before `case "daily_briefing":`:

```ts
    case "get_audit": {
      const entries = Array.isArray(result.entries) ? (result.entries as Array<Record<string, unknown>>) : [];
      return entries.length
        ? `<ol class="timeline">${entries.map(entryRow).join("")}</ol>`
        : `<p class="empty">I have no record of that.</p>`;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/screens.test.ts`
Expected: PASS

- [ ] **Step 5: Make `get_audit` an app tool**

In `src/mcp/appResource.ts`, add `"get_audit"`:

```ts
export const UI_TOOLS = [
  "get_scan", "list_items", "get_item", "daily_briefing", "identify_product", "find_object",
  "get_backlog", "get_audit"
] as const;
```

In `src/mcp/server.ts`, replace the `get_audit` registration header (lines 276-280):

```ts
  server.tool(
    "get_audit",
    "Explain what happened to a document or thread, from the record.",
    { documentId: z.string().optional(), threadKey: z.string().optional() },
    async ({ documentId, threadKey }) => {
```

with:

```ts
  registerAppTool(
    server,
    "get_audit",
    {
      description: "Explain what happened to a document or thread, from the record.",
      inputSchema: { documentId: z.string().optional(), threadKey: z.string().optional() },
      _meta: { ui: { resourceUri: APP_RESOURCE_URI } }
    },
    async ({ documentId, threadKey }) => {
```

- [ ] **Step 6: Add the timeline styles**

In `ui/src/styles.css`, append:

```css
.timeline { list-style: none; margin: 0; padding: 0; }
.timeline__item { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid color-mix(in srgb, var(--wf-fg) 12%, transparent); }
.timeline__meta { color: var(--wf-muted); font-size: 0.9rem; }
```

- [ ] **Step 7: Run the gates**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/mcp/appResource.ts src/mcp/server.ts ui/src/screens.ts ui/src/styles.css test/screens.test.ts
git commit -m "feat(ui): add the audit history screen"
```

---

### Task 3: Verification badge screen

**Files:**
- Modify: `src/mcp/appResource.ts:4-6`
- Modify: `src/mcp/server.ts:298-315` (the `verify_ledger` registration)
- Modify: `ui/src/screens.ts` (add a `case`)
- Modify: `ui/src/styles.css` (add `.badge*`)
- Test: `test/screens.test.ts`

**Interfaces:**
- Consumes: the `verify_ledger` tool returns `structuredContent: { ok: boolean; entries: number; firstMismatchSeq?: number; terminal: string }` (`src/mcp/server.ts:310`).
- Produces: a `case "verify_ledger"` branch in `renderScreen`.

- [ ] **Step 1: Write the failing tests**

Add to `test/screens.test.ts`:

```ts
describe("renderScreen: verify_ledger", () => {
  it("renders a verified badge with the entry count and terminal hash", () => {
    const html = renderScreen({
      toolName: "verify_ledger",
      arguments: {},
      result: { ok: true, entries: 2, terminal: "abc123" }
    });
    expect(html).toContain("badge--ok");
    expect(html).toContain("Chain verified");
    expect(html).toContain("2 entries");
    expect(html).toContain("abc123");
  });

  it("renders a tampered badge with the first mismatching sequence", () => {
    const html = renderScreen({
      toolName: "verify_ledger",
      arguments: {},
      result: { ok: false, entries: 2, firstMismatchSeq: 2 }
    });
    expect(html).toContain("badge--bad");
    expect(html).toContain("Entry 2 was changed");
  });

  it("renders an empty state when there is no result", () => {
    expect(renderScreen({ toolName: "verify_ledger", arguments: {}, result: {} })).toBe(
      '<p class="empty">Nothing to verify yet.</p>'
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/screens.test.ts`
Expected: FAIL — `verify_ledger` falls through to `default`.

- [ ] **Step 3: Render the badge**

In `ui/src/screens.ts`, add this `case` before `case "daily_briefing":`:

```ts
    case "verify_ledger": {
      if (typeof result.ok !== "boolean") return `<p class="empty">Nothing to verify yet.</p>`;
      const entries = typeof result.entries === "number" ? result.entries : 0;
      const terminal = typeof result.terminal === "string" ? result.terminal : "";
      if (result.ok) {
        return `<section class="badge badge--ok" role="status"><strong>Chain verified</strong><p class="badge__meta">${entries} entr${entries === 1 ? "y" : "ies"} — <code>${escape(terminal)}</code></p></section>`;
      }
      return `<section class="badge badge--bad" role="alert"><strong>Record does not verify</strong><p class="badge__meta">Entry ${escape(result.firstMismatchSeq ?? "?")} was changed.</p></section>`;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/screens.test.ts`
Expected: PASS

- [ ] **Step 5: Make `verify_ledger` an app tool**

In `src/mcp/appResource.ts`, add `"verify_ledger"`:

```ts
export const UI_TOOLS = [
  "get_scan", "list_items", "get_item", "daily_briefing", "identify_product", "find_object",
  "get_backlog", "get_audit", "verify_ledger"
] as const;
```

In `src/mcp/server.ts`, replace the `verify_ledger` registration header (lines 298-302):

```ts
  server.tool(
    "verify_ledger",
    "Prove the record has not been altered since it was written.",
    {},
    async () => {
```

with:

```ts
  registerAppTool(
    server,
    "verify_ledger",
    {
      description: "Prove the record has not been altered since it was written.",
      inputSchema: {},
      _meta: { ui: { resourceUri: APP_RESOURCE_URI } }
    },
    async () => {
```

- [ ] **Step 6: Add the badge styles**

In `ui/src/styles.css`, append:

```css
.badge { border-radius: var(--wf-radius); padding: 16px; }
.badge--ok { background: #e7f6ec; color: #14532d; }
.badge--bad { background: var(--wf-alert-bg); color: var(--wf-alert-fg); }
.badge__meta { margin: 8px 0 0; }
.badge code { overflow-wrap: anywhere; }
```

- [ ] **Step 7: Run the gates**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/mcp/appResource.ts src/mcp/server.ts ui/src/screens.ts ui/src/styles.css test/screens.test.ts
git commit -m "feat(ui): add the ledger verification badge"
```

---

### Task 4: Refusal card and escalate affordance

**Files:**
- Modify: `src/mcp/server.ts:163-204` (the `act_on_item` registration and payload) and `:335-374` (the `escalate_item` payload)
- Modify: `src/mcp/appResource.ts:4-6`
- Modify: `ui/src/screens.ts` (add a refusal branch to the `act_on_item` case; add an `escalate_item` case)
- Modify: `ui/src/main.ts` (confirm with `confirmed: true`; add escalate wiring)
- Modify: `ui/src/styles.css` (add `.refusal`)
- Test: `test/screens.test.ts`, `test/governedTools.test.ts`

**Interfaces:**
- Consumes: `act_on_item` returns `structuredContent: { action: Action; item: Item; decision: AuthorityDecision; message: string }` after this task; `AuthorityDecision = "allow" | "confirm" | "refuse" | "escalate"` (`src/domain/authority.ts:7`). `escalate_item` returns `structuredContent: { escalated: true; alias: string }` after this task.
- Produces: a refusal branch in the `act_on_item` case, a `case "escalate_item"`, `escalateItem()`/`wireEscalate()` in the View, and `"act_on_item"` in `UI_TOOLS`.

- [ ] **Step 1: Write the failing tests**

Add to `test/screens.test.ts`:

```ts
describe("renderScreen: refusal card", () => {
  it("shows the refusal reason and an escalate affordance", () => {
    const html = renderScreen({
      toolName: "act_on_item",
      arguments: {},
      result: {
        decision: "refuse",
        message: "You have not allowed me to discard document.",
        action: { type: "discard", status: "proposed" },
        item: { itemId: "itm_ref", readAloudText: "Old bill" }
      }
    });
    expect(html).toContain("card--alert");
    expect(html).toContain("You have not allowed me to discard document.");
    expect(html).toContain('class="escalate"');
    expect(html).toContain('data-document-id="itm_ref"');
    expect(html).not.toContain("card--info");
  });

  it("escapes hostile refusal text and item ids", () => {
    const html = renderScreen({
      toolName: "act_on_item",
      arguments: {},
      result: { decision: "refuse", message: "<b>no</b>", item: { itemId: '"><img src=x>' } }
    });
    expect(html).toContain("&lt;b&gt;no&lt;/b&gt;");
    expect(html).toContain('data-document-id="&quot;&gt;&lt;img src=x&gt;"');
    expect(html).not.toContain("<img");
  });

  it("still renders an executed action as an info card", () => {
    const html = renderScreen({
      toolName: "act_on_item",
      arguments: {},
      result: { decision: "allow", action: { type: "Pay", status: "done" }, item: { readAloudText: "Paid" } }
    });
    expect(html).toContain("Pay · done");
    expect(html).toContain("card--info");
  });
});

describe("renderScreen: escalation result", () => {
  it("confirms the escalation with the contact alias", () => {
    const html = renderScreen({
      toolName: "escalate_item",
      arguments: {},
      result: { escalated: true, alias: "Priya" }
    });
    expect(html).toContain("Escalated");
    expect(html).toContain("I've asked Priya to help with that.");
  });

  it("falls back when the alias is missing", () => {
    const html = renderScreen({ toolName: "escalate_item", arguments: {}, result: { escalated: true } });
    expect(html).toContain("your trusted contact");
  });

  it("reports a failure when the escalation failed", () => {
    expect(renderScreen({ toolName: "escalate_item", arguments: {}, result: { failed: true } })).toBe(
      '<p class="empty">I couldn\'t reach your trusted contact.</p>'
    );
  });
});
```

Add to `test/governedTools.test.ts` (new describes at the end):

```ts
describe("act_on_item refusal payload", () => {
  it("returns the decision and reason for the refusal card", async () => {
    const { client, store } = await connect();
    await store.putItem(item({
      itemId: "itm_ref",
      proposedActions: [{ actionId: "a1", itemId: "itm_ref", type: "discard", status: "proposed", params: {} }]
    }));
    await store.putPreferences({
      ...(await store.getPreferences()),
      authority: {
        autoActUpTo: { currency: "EUR", value: 0 },
        confirmAbove: { currency: "EUR", value: 0 },
        forbidden: ["discard_document"],
        onLowConfidence: "ask"
      }
    });
    const res = await client.callTool({ name: "act_on_item", arguments: { itemId: "itm_ref", actionId: "a1" } });
    const sc = res.structuredContent as { decision: string; message: string };
    expect(sc.decision).toBe("refuse");
    expect(sc.message).toBe(copy.authority.forbidden("discard_document"));
    await client.close();
  });
});

describe("escalate_item alias payload", () => {
  it("returns the trusted contact alias", async () => {
    const { client, store } = await connect();
    await store.putItem(item({ itemId: "itm_esc" }));
    await store.putPreferences({ ...(await store.getPreferences()), trustedContactAlias: "Priya" });
    const res = await client.callTool({ name: "escalate_item", arguments: { documentId: "itm_esc" } });
    const sc = res.structuredContent as { escalated: boolean; alias: string };
    expect(sc).toEqual({ escalated: true, alias: "Priya" });
    await client.close();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/screens.test.ts test/governedTools.test.ts`
Expected: FAIL — the refusal card renders the plain info card; `sc.alias` is `undefined`.

- [ ] **Step 3: Extend the two tool payloads**

In `src/mcp/server.ts`, in the `act_on_item` handler's return, add `message`:

```ts
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: { action: result.action, item: result.item, decision: result.decision, message: result.message }
        };
```

In the `escalate_item` handler's return, add `alias`:

```ts
        return {
          content: [{ type: "text", text: escalated }],
          structuredContent: { escalated: true, alias: preferences.trustedContactAlias }
        };
```

- [ ] **Step 4: Make `act_on_item` an app tool**

In `src/mcp/appResource.ts`, add `"act_on_item"`:

```ts
export const UI_TOOLS = [
  "get_scan", "list_items", "get_item", "daily_briefing", "identify_product", "find_object",
  "get_backlog", "get_audit", "verify_ledger", "act_on_item"
] as const;
```

In `src/mcp/server.ts`, replace the `act_on_item` registration header (lines 163-167):

```ts
  server.tool(
    "act_on_item",
    "Carry out one of the suggested actions for an item after the customer confirms it.",
    { itemId: z.string(), actionId: z.string(), confirmed: z.boolean().default(false) },
    async ({ itemId, actionId, confirmed }) => {
```

with:

```ts
  registerAppTool(
    server,
    "act_on_item",
    {
      description: "Carry out one of the suggested actions for an item after the customer confirms it.",
      inputSchema: { itemId: z.string(), actionId: z.string(), confirmed: z.boolean().default(false) },
      _meta: { ui: { resourceUri: APP_RESOURCE_URI } }
    },
    async ({ itemId, actionId, confirmed }) => {
```

- [ ] **Step 5: Render the refusal card and escalation result**

In `ui/src/screens.ts`, replace the existing `act_on_item` case body with:

```ts
    case "act_on_item": {
      const decision = String(result.decision ?? "allow");
      const action = (result.action ?? {}) as Record<string, unknown>;
      const item = (result.item ?? {}) as Record<string, unknown>;
      if (decision === "refuse" || decision === "escalate") {
        const documentId = item.itemId !== undefined ? String(item.itemId) : "";
        const attr = documentId ? ` data-document-id="${escape(documentId)}"` : "";
        const heading = decision === "escalate" ? "Needs help" : "Not allowed";
        return `<section class="card card--alert refusal" role="alert"><h2>${escape(heading)}</h2><p>${escape(result.message ?? "")}</p><div class="actions"><button type="button" class="escalate"${attr}>Ask my trusted contact to help</button></div></section>`;
      }
      const status = action.status ? ` · ${action.status}` : "";
      return card(`${String(action.type ?? "Done")}${status}`, `<p>${escape(item.readAloudText ?? "")}</p>`, "info");
    }
```

Add this new case before `case "find_object":`:

```ts
    case "escalate_item": {
      if (result.failed === true) return `<p class="empty">I couldn't reach your trusted contact.</p>`;
      const alias = typeof result.alias === "string" && result.alias ? result.alias : "your trusted contact";
      return card("Escalated", `<p>${escape(`I've asked ${alias} to help with that.`)}</p>`, "info");
    }
```

- [ ] **Step 6: Add the `.refusal` style**

In `ui/src/styles.css`, append:

```css
.refusal h2 { text-transform: none; }
```

- [ ] **Step 7: Wire confirmation and escalation in the View**

In `ui/src/main.ts`, add `wireEscalate()` to `paint`:

```ts
function paint(): void {
  root.innerHTML = renderScreen(current) + (pendingAction ? renderConfirm(pendingAction) : "");
  wireActions();
  wireConfirm();
  wireEscalate();
  // Report height so the host can size the iframe.
  void app.sendSizeChanged({ height: document.documentElement.scrollHeight });
}
```

Change the confirmation call to confirm the action:

```ts
    const res = await app.callServerTool({
      name: "act_on_item",
      arguments: { itemId: pending.itemId, actionId: pending.actionId, confirmed: true }
    });
```

Add these functions after `confirmAction`:

```ts
function wireEscalate(): void {
  root.querySelectorAll<HTMLButtonElement>("button.escalate").forEach((button) => {
    button.addEventListener("click", () => void escalateItem(button));
  });
}

async function escalateItem(button: HTMLButtonElement): Promise<void> {
  const documentId = button.dataset.documentId;
  if (!documentId) return;
  button.disabled = true;
  try {
    const res = await app.callServerTool({ name: "escalate_item", arguments: { documentId } });
    current = { ...current, toolName: "escalate_item", result: res.isError ? { failed: true } : res.structuredContent };
  } catch (err) {
    console.error("[view] escalation failed:", err);
    current = { ...current, toolName: "escalate_item", result: { failed: true } };
  } finally {
    button.disabled = false;
  }
  paint();
}
```

- [ ] **Step 8: Run the gates**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass. The existing `test/screens.test.ts` "renders the action and item card" case still passes because an absent `decision` defaults to `"allow"`.

- [ ] **Step 9: Commit**

```bash
git add src/mcp/appResource.ts src/mcp/server.ts ui/src/screens.ts ui/src/styles.css ui/src/main.ts test/screens.test.ts test/governedTools.test.ts
git commit -m "feat(ui): show refusals and let the customer escalate"
```

---

## Self-Review

**Spec coverage**
- §5.3 "backlog (threads + urgency + reminder count)" → Task 1 renders sender, demand, urgency, reminder count, deadline, document count.
- §5.3 "audit/history" → Task 2 renders the ledger timeline for the returned entries.
- §5.3 "verification badge (shows `verify_ledger` result)" → Task 3 renders the ok/tampered badge with the terminal hash and mismatch sequence.
- §5.3 "refusal card (reason + escalate affordance)" → Task 4 renders the surfaced `message` plus an escalate button that calls `escalate_item`.
- §5.3 resources `wayfinder://ledger`, `wayfinder://inbox`, `wayfinder://objects`, `wayfinder://capabilities` → already implemented in v1/Plan 7; unchanged, and `test/tools.test.ts:167` asserts the exact resource list. No new resource is needed for a screen (screens are branches of `ui://wayfinder/app.html`).
- §7 Accessibility "voice-first: verification results and refusal reasons are spoken" → the tools already speak (`copy.ledger.*`, `verdict.reason` via `content[0].text`); Task 4 additionally surfaces the reason visually. No change to the spoken path.
- §2.3 "Refusals … offer escalation to the trusted contact" → Task 4's escalate affordance.

**Out of scope (deliberately not in this plan)**
- A backlog/resource URI beyond the four in §5.3; the `daily_briefing` screen remains counts-only (the tool already speaks the ranked backlog lead).
- A persistent verification badge on other screens; §5.3 lists it as one screen.
- The `<500 ms` budget and adapter behaviour: untouched.
- Screen rendering for `escalate_item` when the *agent* (not the View) calls it: it is not a UI tool, so no host card. The refusal card covers the spec's affordance.

**Placeholder scan:** no TBD/TODO/"handle edge cases"/"similar to Task N"; every step carries exact code and commands.

**Type consistency:**
- `renderScreen` keeps its single `ScreenInput` signature; all new cases read from `result: Record<string, unknown>`.
- `threadCard`/`entryRow` names are used only where defined.
- `act_on_item` structured content adds `message: string` — matches `ApplyResult.message` (`src/domain/applyAction.ts:12`) and the View's `result.message`.
- `escalate_item` structured content adds `alias: string` — matches the View's `result.alias` and the existing `copy.escalated(alias)` wording.
- `UI_TOOLS` is the single union of app-tool names; each task appends to it and `test/uiMeta.test.ts` enforces the `_meta` on every entry.
- Nothing in `ui/` imports `src/domain`; the View uses literals, matching constraint and existing code.
