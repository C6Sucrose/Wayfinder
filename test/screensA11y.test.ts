import { describe, it, expect } from "vitest";
import { renderScreen } from "../ui/src/screens.js";

const bill = {
  itemId: "itm_bill",
  class: "bill",
  confidence: 0.9,
  readAloudText: "Water bill",
  fields: { sender: "City Water", dueDate: "2026-09-22", amount: { value: 42.5, currency: "EUR" } },
  proposedActions: [{ actionId: "a", type: "remind", status: "proposed", params: {} }],
  createdAt: "2026-09-19T10:00:00.000Z",
  resolvedAt: null,
  record: { lifecycle: "open", confidence: "high", needsRecapture: false, demands: [], threadKey: "t1" }
};

const screens: Array<[string, unknown]> = [
  ["list_items", { items: [bill] }],
  ["get_scan", { items: [bill] }],
  ["get_item", { item: bill }],
  ["daily_briefing", { due: [bill], appointments: [], flagged: [], objectReminders: [], backlog: [] }],
  ["get_backlog", { backlog: [{ thread: { threadKey: "t1", sender: "City Water", demandType: "payment", urgency: "high", reminderCount: 1, outstanding: true }, documents: [bill], deadline: "2026-09-22" }] }],
  ["get_audit", { entries: [{ seq: 1, at: "2026-09-20T12:00:00.000Z", actor: "agent", event: "ingested", details: { a: 1 } }] }],
  ["verify_ledger", { ok: true, entries: 3, terminal: "deadbeef" }],
  ["identify_product", { available: true, name: "Acme", labelText: "Ibuprofen", disclaimer: "Not advice" }],
  ["find_object", { found: { name: "Keys", locationNote: "hook" } }],
  ["act_on_item", { decision: "refuse", message: "Not allowed", item: bill }],
  ["escalate_item", { escalated: true, alias: "Priya" }]
];

describe("screens: accessible structure", () => {
  for (const [tool, result] of screens) {
    it(`${tool} exposes a single h1 and a region label`, () => {
      const html = renderScreen({ toolName: tool, arguments: {}, result });
      const h1s = html.match(/<h1[\s>]/g) ?? [];
      expect(h1s.length, tool).toBe(1);
      expect(html).toContain('class="screen" aria-labelledby="wf-title"');
      expect(html).toContain('id="wf-title"');
    });

    it(`${tool} uses native buttons only`, () => {
      const html = renderScreen({ toolName: tool, arguments: {}, result });
      const buttons = html.match(/<button[^>]*>/g) ?? [];
      for (const button of buttons) {
        expect(button, tool).toContain('type="button"');
      }
      expect(html).not.toMatch(/<div[^>]*onclick/i);
      expect(html).not.toMatch(/<a\s|role="button"/i);
    });

    it(`${tool} marks decorative icons as hidden`, () => {
      const html = renderScreen({ toolName: tool, arguments: {}, result });
      const icons = html.match(/<span class="[^"]*(icon|pill__icon)[^"]*"[^>]*>/g) ?? [];
      for (const icon of icons) {
        expect(icon, tool).toContain('aria-hidden="true"');
      }
    });
  }
});

describe("screens: meaning is never carried by colour alone", () => {
  it("states confidence in words", () => {
    expect(renderScreen({ toolName: "get_item", arguments: {}, result: { item: bill } })).toContain("High confidence");
    const low = { ...bill, record: { ...bill.record, confidence: "low" } };
    expect(renderScreen({ toolName: "get_item", arguments: {}, result: { item: low } })).toContain("Low confidence");
  });

  it("states urgency in words", () => {
    const entry = { thread: { threadKey: "t", sender: "X", demandType: "payment", urgency: "high", reminderCount: 0, outstanding: true }, documents: [] };
    expect(renderScreen({ toolName: "get_backlog", arguments: {}, result: { backlog: [entry] } })).toContain("High urgency");
  });
});

describe("screens: live regions", () => {
  it("announces verification results", () => {
    expect(renderScreen({ toolName: "verify_ledger", arguments: {}, result: { ok: true, entries: 1, terminal: "x" } })).toContain('role="status"');
    expect(renderScreen({ toolName: "verify_ledger", arguments: {}, result: { ok: false, entries: 1, firstMismatchSeq: 1 } })).toContain('role="alert"');
  });

  it("announces refusals and failures", () => {
    const refused = renderScreen({ toolName: "act_on_item", arguments: {}, result: { decision: "refuse", message: "no", item: bill } });
    expect(refused).toContain('role="alert"');
    expect(renderScreen({ toolName: "act_on_item", arguments: {}, result: { failed: true } })).toContain('role="status"');
  });

  it("announces empty states and keeps a heading", () => {
    for (const tool of ["list_items", "get_backlog", "get_audit", "verify_ledger", "find_object"]) {
      const html = renderScreen({ toolName: tool, arguments: {}, result: {} });
      expect(html, tool).toContain('role="status"');
      expect(html.match(/<h1[\s>]/g)?.length, tool).toBe(1);
    }
  });
});
