import { describe, it, expect } from "vitest";
import { renderConfirm, renderPending, renderScreen } from "../ui/src/screens.js";

const money = { value: 42.5, currency: "EUR" };

const billItem = {
  itemId: "itm_bill",
  class: "bill",
  confidence: 0.9,
  readAloudText: "Water bill for 42.50 euro, due 2026-09-22",
  fields: { sender: "City Water", dueDate: "2026-09-22", amount: money, reference: "INV-1" },
  proposedActions: [
    { actionId: "a_pay", type: "remind", status: "proposed", params: {} },
    { actionId: "a_file", type: "file", status: "proposed", params: {} }
  ],
  createdAt: "2026-09-19T10:00:00.000Z",
  resolvedAt: null,
  record: { lifecycle: "awaiting_action", confidence: "high", needsRecapture: false, demands: [{ type: "payment", deadline: "2026-09-22" }], threadKey: "t_bill" }
};

const scamItem = {
  itemId: "s1",
  class: "scam",
  confidence: 0.4,
  readAloudText: '<img src=x onerror=alert(1)>',
  fields: { dueDate: "2026-01-05" },
  proposedActions: [{ actionId: "report", type: "flag", status: "proposed", params: {} }],
  createdAt: "2026-09-19T10:00:00.000Z",
  resolvedAt: null,
  record: { lifecycle: "open", confidence: "low", needsRecapture: false, demands: [], threadKey: "t_scam" }
};

describe("renderScreen: document lists", () => {
  it("renders each document as an article inside a labelled list", () => {
    const html = renderScreen({ toolName: "list_items", arguments: {}, result: { items: [billItem] } });
    expect(html).toContain('<section class="screen" aria-labelledby="wf-title">');
    expect(html).toContain('<h1 id="wf-title" class="screen__title">Documents</h1>');
    expect(html).toContain('<ul class="docs"');
    expect(html).toContain("<li>");
    expect(html).toContain('<article class="doc" data-item-id="itm_bill">');
  });

  it("shows the sender, amount, due date, and reference as labelled facts", () => {
    const html = renderScreen({ toolName: "list_items", arguments: {}, result: { items: [billItem] } });
    expect(html).toContain("<dt>From</dt><dd>City Water</dd>");
    expect(html).toContain("<dt>Amount</dt><dd>EUR 42.50</dd>");
    expect(html).toContain("<dt>Due</dt><dd>2026-09-22</dd>");
    expect(html).toContain("<dt>Reference</dt><dd>INV-1</dd>");
  });

  it("states confidence in words and a symbol, never by colour alone", () => {
    const html = renderScreen({ toolName: "list_items", arguments: {}, result: { items: [billItem, scamItem] } });
    expect(html).toContain("Low confidence");
    expect(html).toContain("High confidence");
    expect(html).toContain('<span class="pill__icon" aria-hidden="true">');
  });

  it("offers each proposed action as a native button carrying ids", () => {
    const html = renderScreen({ toolName: "list_items", arguments: {}, result: { items: [billItem] } });
    expect(html).toContain('<button type="button" class="action" data-item-id="itm_bill" data-action-id="a_pay"');
    expect(html).toContain(">remind</button>");
  });

  it("escapes hostile item text and identifiers", () => {
    const hostile = {
      itemId: 'a"><img src=x>',
      class: "bill",
      readAloudText: "A bill",
      fields: {},
      proposedActions: [{ actionId: "'><script>alert(1)</script>", type: "file", status: "proposed", params: {} }],
      createdAt: "2026-09-19T10:00:00.000Z",
      resolvedAt: null
    };
    const html = renderScreen({ toolName: "list_items", arguments: {}, result: { items: [hostile] } });
    expect(html).toContain('data-item-id="a&quot;&gt;&lt;img src=x&gt;"');
    expect(html).toContain('data-action-id="&#39;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
  });

  it("shows an announced empty state", () => {
    const html = renderScreen({ toolName: "list_items", arguments: {}, result: { items: [] } });
    expect(html).toContain('<p class="empty" role="status">Nothing to show yet.</p>');
  });

  it("falls back safely for malformed payloads", () => {
    expect(renderScreen({ toolName: "get_scan", arguments: {}, result: { items: "nope" } })).toContain("Nothing to show yet.");
    expect(renderScreen({ toolName: "get_scan", arguments: {}, result: null })).toContain("Nothing to show yet.");
  });
});

describe("renderScreen: document detail", () => {
  it("renders a reading heading, facts, and the read-aloud text", () => {
    const html = renderScreen({ toolName: "get_item", arguments: {}, result: { item: billItem } });
    expect(html).toContain('<h1 id="wf-title" class="screen__title">Bill</h1>');
    expect(html).toContain("Water bill for 42.50 euro");
    expect(html).toContain("<dt>From</dt>");
  });

  it("shows recorded confirmation when present", () => {
    const confirmed = {
      ...billItem,
      record: { ...billItem.record, lifecycle: "confirmed", confirmation: { at: "2026-09-20T09:00:00.000Z", detail: "Reminder set for Friday" } }
    };
    const html = renderScreen({ toolName: "get_item", arguments: {}, result: { item: confirmed } });
    expect(html).toContain("Confirmed");
    expect(html).toContain("Reminder set for Friday");
  });

  it("flags a document that needs recapturing", () => {
    const low = { ...billItem, record: { ...billItem.record, confidence: "low", needsRecapture: true } };
    const html = renderScreen({ toolName: "get_item", arguments: {}, result: { item: low } });
    expect(html).toContain("Low confidence");
    expect(html).toContain("Needs re-capturing");
  });

  it("renders an announced empty state when the item is absent", () => {
    const html = renderScreen({ toolName: "get_item", arguments: {}, result: {} });
    expect(html).toContain('<p class="empty" role="status">No item.</p>');
    expect(html).toContain('<h1 id="wf-title"');
  });
});

describe("renderScreen: today", () => {
  const today = {
    due: [billItem],
    appointments: [{ itemId: "itm_appt", class: "appointment", readAloudText: "Dentist", fields: { appointmentAt: "2026-09-25T09:00:00.000Z" }, proposedActions: [] }],
    flagged: [scamItem],
    objectReminders: [{ objectId: "obj_k", name: "keys", locationNote: "entry table", lastSeenAt: "2026-09-19T10:00:00.000Z" }],
    backlog: [{ thread: { sender: "City Water", demandType: "payment", urgency: "high", reminderCount: 2, outstanding: true }, documents: [], deadline: "2026-09-22" }]
  };

  it("leads with the most urgent thread and lists every category", () => {
    const html = renderScreen({ toolName: "daily_briefing", arguments: {}, result: today });
    expect(html).toContain('<h1 id="wf-title" class="screen__title">Today</h1>');
    expect(html).toContain("City Water");
    expect(html).toContain("Dentist");
    expect(html).toContain("keys");
    expect(html).toContain("Due");
    expect(html).toContain("Flagged");
  });

  it("says so clearly when nothing needs attention", () => {
    const html = renderScreen({ toolName: "daily_briefing", arguments: {}, result: { due: [], appointments: [], flagged: [], objectReminders: [], backlog: [] } });
    expect(html).toContain("Nothing needs your attention today.");
  });
});

describe("renderScreen: backlog", () => {
  const entry = {
    thread: {
      threadKey: "t1", sender: "City Water", demandType: "payment", documentIds: ["d1", "d2"],
      firstSeenAt: "2026-09-01T00:00:00.000Z", lastSeenAt: "2026-09-18T00:00:00.000Z",
      reminderCount: 2, urgency: "high", outstanding: true
    },
    documents: [{ itemId: "d1", class: "bill", readAloudText: "First notice" }],
    deadline: "2026-09-22"
  };

  it("renders a thread with urgency in words, deadline, reminders, and documents", () => {
    const html = renderScreen({ toolName: "get_backlog", arguments: {}, result: { backlog: [entry] } });
    expect(html).toContain('<h1 id="wf-title" class="screen__title">Backlog</h1>');
    expect(html).toContain("City Water");
    expect(html).toContain("High urgency");
    expect(html).toContain("2026-09-22");
    expect(html).toContain("2 reminders");
    expect(html).toContain("First notice");
  });

  it("offers a history affordance for the thread", () => {
    const html = renderScreen({ toolName: "get_backlog", arguments: {}, result: { backlog: [entry] } });
    expect(html).toContain('class="view-history"');
    expect(html).toContain('data-thread-key="t1"');
  });

  it("escapes hostile thread text", () => {
    const hostile = { thread: { sender: "<img src=x onerror=alert(1)>", demandType: "payment", urgency: "medium", reminderCount: 0 }, documents: [] };
    const html = renderScreen({ toolName: "get_backlog", arguments: {}, result: { backlog: [hostile] } });
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
  });

  it("renders an announced empty state", () => {
    const html = renderScreen({ toolName: "get_backlog", arguments: {}, result: { backlog: [] } });
    expect(html).toContain('<p class="empty" role="status">Nothing is waiting on you right now.</p>');
    expect(html).toContain('<h1 id="wf-title"');
  });
});

describe("renderScreen: history", () => {
  const entries = [
    { seq: 1, at: "2026-09-20T12:00:00.000Z", actor: "agent", event: "ingested", details: {} },
    { seq: 2, at: "2026-09-20T12:01:00.000Z", actor: "user", event: "action_confirmed", details: { actionType: "remind" } }
  ];

  it("describes each event in plain language with actor and time", () => {
    const html = renderScreen({ toolName: "get_audit", arguments: {}, result: { entries } });
    expect(html).toContain('<h1 id="wf-title" class="screen__title">History</h1>');
    expect(html).toContain("Read the document");
    expect(html).toContain("You confirmed an action");
    expect(html).toContain("2026-09-20");
  });

  it("keeps machine detail inside an expandable disclosure", () => {
    const html = renderScreen({ toolName: "get_audit", arguments: {}, result: { entries } });
    expect(html).toContain("<details");
    expect(html).toContain("action_confirmed");
  });

  it("renders an announced empty state", () => {
    const html = renderScreen({ toolName: "get_audit", arguments: {}, result: { entries: [] } });
    expect(html).toContain('<p class="empty" role="status">I have no record of that.</p>');
    expect(html).toContain('<h1 id="wf-title"');
  });
});

describe("renderScreen: verification", () => {
  it("announces a verified chain with a labelled, copyable hash", () => {
    const html = renderScreen({ toolName: "verify_ledger", arguments: {}, result: { ok: true, entries: 2, terminal: "abc123" } });
    expect(html).toContain('class="verify verify--ok" role="status"');
    expect(html).toContain("Chain verified");
    expect(html).toContain("2 entries");
    expect(html).toContain('class="hash"');
    expect(html).toContain("abc123");
    expect(html).toContain('class="recheck"');
  });

  it("renders a tampered chain as an alert with the failing entry", () => {
    const html = renderScreen({ toolName: "verify_ledger", arguments: {}, result: { ok: false, entries: 2, firstMismatchSeq: 2 } });
    expect(html).toContain('class="verify verify--bad" role="alert"');
    expect(html).toContain("Entry 2 was changed");
  });

  it("renders an announced empty state", () => {
    const html = renderScreen({ toolName: "verify_ledger", arguments: {}, result: {} });
    expect(html).toContain('<p class="empty" role="status">Nothing to verify yet.</p>');
    expect(html).toContain('<h1 id="wf-title"');
  });
});

describe("renderScreen: labels", () => {
  it("shows the label text with its disclaimer", () => {
    const html = renderScreen({
      toolName: "identify_product",
      arguments: {},
      result: { available: true, name: "Acme", labelText: "Ibuprofen 400mg", disclaimer: "Not medical advice" }
    });
    expect(html).toContain("Acme");
    expect(html).toContain("Ibuprofen 400mg");
    expect(html).toContain("Not medical advice");
  });

  it("reports an unavailable label in an announced state", () => {
    const html = renderScreen({ toolName: "identify_product", arguments: {}, result: { available: false } });
    expect(html).toContain('<p class="empty" role="status">I couldn&#39;t read that label.</p>');
    expect(html).toContain('<h1 id="wf-title"');
  });
});

describe("renderScreen: object memory", () => {
  it("shows the object and where it was last seen", () => {
    const html = renderScreen({ toolName: "find_object", arguments: {}, result: { found: { name: "Keys", locationNote: "on the hook" } } });
    expect(html).toContain("Keys");
    expect(html).toContain("on the hook");
  });

  it("renders an announced empty state", () => {
    const html = renderScreen({ toolName: "find_object", arguments: {}, result: {} });
    expect(html).toContain('<p class="empty" role="status">I don&#39;t have a location for that.</p>');
    expect(html).toContain('<h1 id="wf-title"');
  });
});

describe("renderScreen: acting on a document", () => {
  it("confirms a completed action", () => {
    const html = renderScreen({
      toolName: "act_on_item",
      arguments: {},
      result: { decision: "allow", action: { type: "file", status: "done" }, item: billItem }
    });
    expect(html).toContain("file · done");
    expect(html).toContain("City Water");
  });

  it("shows a failure in an announced state", () => {
    const html = renderScreen({ toolName: "act_on_item", arguments: {}, result: { failed: true } });
    expect(html).toContain('<p class="empty" role="status">I couldn&#39;t do that — please choose the action again.</p>');
    expect(html).toContain('<h1 id="wf-title"');
  });
});

describe("renderScreen: refusals", () => {
  it("explains the refusal and offers escalation, naming the document", () => {
    const html = renderScreen({
      toolName: "act_on_item",
      arguments: {},
      result: {
        decision: "refuse",
        message: "You have not allowed me to discard document.",
        action: { type: "discard", status: "proposed" },
        item: billItem
      }
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain("You have not allowed me to discard document.");
    expect(html).toContain('<button type="button" class="escalate" data-document-id="itm_bill"');
    expect(html).toContain("City Water");
  });

  it("escapes hostile refusal text and ids", () => {
    const html = renderScreen({
      toolName: "act_on_item",
      arguments: {},
      result: { decision: "refuse", message: "<b>no</b>", item: { itemId: '"><img src=x>', class: "bill", fields: {} } }
    });
    expect(html).toContain("&lt;b&gt;no&lt;/b&gt;");
    expect(html).toContain('data-document-id="&quot;&gt;&lt;img src=x&gt;"');
    expect(html).not.toContain("<img");
  });

  it("reports an already-escalated decision without offering a duplicate escalation", () => {
    const html = renderScreen({
      toolName: "act_on_item",
      arguments: {},
      result: { decision: "escalate", message: "I'll ask your trusted contact to help.", item: billItem }
    });
    expect(html).toContain("Needs help");
    expect(html).not.toContain('class="escalate"');
  });

  it("confirms an escalation with the contact alias", () => {
    const html = renderScreen({ toolName: "escalate_item", arguments: {}, result: { escalated: true, alias: "Priya" } });
    expect(html).toContain("Priya");
  });

  it("reports a failed escalation in an announced state", () => {
    const html = renderScreen({ toolName: "escalate_item", arguments: {}, result: { failed: true } });
    expect(html).toContain('<p class="empty" role="status">I couldn&#39;t reach your trusted contact.</p>');
    expect(html).toContain('<h1 id="wf-title"');
  });
});

describe("renderPending", () => {
  it("renders an announced shimmer placeholder", () => {
    const html = renderPending("Checking the record…");
    expect(html).toContain('class="skeleton"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Checking the record…");
  });
});

describe("renderConfirm", () => {
  it("renders a modal dialog with a heading, the action, and two buttons", () => {
    const html = renderConfirm({ actionId: "a_file", type: "file" });
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="wf-confirm-title"');
    expect(html).toContain('id="wf-confirm-title"');
    expect(html).toContain("file");
    expect(html).toContain('class="confirm__yes" data-action-id="a_file"');
    expect(html).toContain('class="confirm__no"');
  });

  it("escapes a hostile action type and id", () => {
    const html = renderConfirm({ actionId: '\'><img src=x>', type: "<img src=x onerror=alert(1)>" });
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain('data-action-id="&#39;&gt;&lt;img src=x&gt;"');
    expect(html).not.toContain("<img");
  });
});

describe("renderScreen: fallbacks", () => {
  it("renders an announced empty state for unknown tools", () => {
    expect(renderScreen({ toolName: "mystery", arguments: {}, result: {} })).toContain("Nothing to show yet.");
  });
});

describe("renderScreen: visual meters", () => {
  it("draws a confidence ring hidden from assistive tech", () => {
    const html = renderScreen({ toolName: "get_item", arguments: {}, result: { item: billItem } });
    expect(html).toContain('class="ring ring--high" aria-hidden="true"');
    expect(html).toContain('class="ring__value"');
    expect(html).toContain("90%");
  });

  it("marks a low-confidence ring while keeping the words", () => {
    const low = { ...billItem, confidence: 0.4, record: { ...billItem.record, confidence: "low" } };
    const html = renderScreen({ toolName: "get_item", arguments: {}, result: { item: low } });
    expect(html).toContain("ring--low");
    expect(html).toContain("Low confidence");
  });

  it("draws an urgency meter for a thread", () => {
    const entry = {
      thread: { threadKey: "t1", sender: "City Water", demandType: "payment", urgency: "high", reminderCount: 2, outstanding: true },
      documents: [],
      deadline: "2026-09-22"
    };
    const html = renderScreen({ toolName: "get_backlog", arguments: {}, result: { backlog: [entry] } });
    expect(html).toContain('class="meter meter--alert" aria-hidden="true"');
    expect(html).toContain('class="meter__fill"');
    expect(html).toContain("High urgency");
  });

  it("links the ledger into blocks and seals a verified chain", () => {
    const html = renderScreen({ toolName: "verify_ledger", arguments: {}, result: { ok: true, entries: 4, terminal: "abc123" } });
    expect(html).toContain('class="chain chain--verified"');
    expect((html.match(/class="chain__block"/g) ?? []).length).toBe(4);
    expect(html).toContain('class="chain__seal"');
  });

  it("breaks the chain when the record does not verify", () => {
    const html = renderScreen({ toolName: "verify_ledger", arguments: {}, result: { ok: false, entries: 4, firstMismatchSeq: 3 } });
    expect(html).toContain('class="chain chain--broken"');
    expect(html).toContain('class="chain__break"');
  });
});
