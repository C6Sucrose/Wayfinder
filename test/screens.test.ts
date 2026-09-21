import { describe, it, expect } from "vitest";
import { renderConfirm, renderScreen } from "../ui/src/screens.js";

describe("renderScreen: lists and scans", () => {
  const scamItem = {
    itemId: "s1",
    class: "scam",
    readAloudText: '<img src=x onerror=alert(1)>',
    fields: { dueDate: "2026-01-05" },
    proposedActions: [{ actionId: "report", type: "Report" }]
  };

  it("renders a grid with class/due title and alert tone for scams", () => {
    const html = renderScreen({ toolName: "list_items", arguments: {}, result: { items: [scamItem] } });
    expect(html).toContain('<section class="grid">');
    expect(html).toContain("scam · due 2026-01-05");
    expect(html).toContain("card--alert");
  });

  it("renders the same grid for get_scan", () => {
    const html = renderScreen({ toolName: "get_scan", arguments: {}, result: { items: [scamItem] } });
    expect(html).toContain('<section class="grid">');
    expect(html).toContain("card--alert");
  });

  it("escapes hostile item text", () => {
    const html = renderScreen({ toolName: "list_items", arguments: {}, result: { items: [scamItem] } });
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
  });

  it("renders action buttons carrying item and action ids", () => {
    const html = renderScreen({ toolName: "list_items", arguments: {}, result: { items: [scamItem] } });
    expect(html).toContain('<button type="button" class="action"');
    expect(html).toContain('data-item-id="s1"');
    expect(html).toContain('data-action-id="report"');
    expect(html).toContain(">Report</button>");
    expect(html).not.toContain("<ul");
  });

  it("escapes hostile item and action ids in the data attributes", () => {
    const hostile = {
      itemId: 'a"><img src=x>',
      class: "bill",
      readAloudText: "A bill",
      proposedActions: [{ actionId: "'><script>alert(1)</script>", type: "Pay" }]
    };
    const html = renderScreen({ toolName: "list_items", arguments: {}, result: { items: [hostile] } });
    expect(html).toContain('data-item-id="a&quot;&gt;&lt;img src=x&gt;"');
    expect(html).toContain('data-action-id="&#39;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
  });

  it("renders an empty state when there are no items", () => {
    const html = renderScreen({ toolName: "list_items", arguments: {}, result: { items: [] } });
    expect(html).toBe('<p class="empty">Nothing to show yet.</p>');
  });

  it("falls back safely for malformed item payloads", () => {
    expect(renderScreen({ toolName: "get_scan", arguments: {}, result: { items: "nope" } })).toBe(
      '<p class="empty">Nothing to show yet.</p>'
    );
    expect(renderScreen({ toolName: "get_scan", arguments: {}, result: null })).toBe(
      '<p class="empty">Nothing to show yet.</p>'
    );
  });
});

describe("renderScreen: get_item", () => {
  it("renders a single item", () => {
    const html = renderScreen({
      toolName: "get_item",
      arguments: {},
      result: { item: { itemId: "i1", class: "label", readAloudText: "Milk" } }
    });
    expect(html).toContain("<h2>label</h2>");
    expect(html).toContain("<p>Milk</p>");
  });

  it("renders an empty state when the item is absent", () => {
    expect(renderScreen({ toolName: "get_item", arguments: {}, result: {} })).toBe('<p class="empty">No item.</p>');
  });
});

describe("renderScreen: daily_briefing", () => {
  it("renders a reminders card and alert tone when flagged", () => {
    const html = renderScreen({
      toolName: "daily_briefing",
      arguments: {},
      result: { due: [1], flagged: [1], appointments: [1], objectReminders: [1, 2] }
    });
    expect(html).toContain("Reminders");
    expect(html).toContain('<p class="big">2</p>');
    expect(html).toContain("card--info");
    expect(html).toContain("card--alert");
  });

  it("renders the reminders card with no info tone when reminders are absent", () => {
    const html = renderScreen({
      toolName: "daily_briefing",
      arguments: {},
      result: { due: [], flagged: [], appointments: [] }
    });
    expect(html).toContain("Reminders");
    expect(html).not.toContain("card--alert");
    expect(html).not.toContain("card--info");
  });
});

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

describe("renderScreen: identify_product", () => {
  it("renders an escaped name, label, and disclaimer", () => {
    const html = renderScreen({
      toolName: "identify_product",
      arguments: {},
      result: { available: true, name: "<b>Acme</b>", labelText: "Ingredients <x>", disclaimer: "Not <advice>" }
    });
    expect(html).toContain("&lt;b&gt;Acme&lt;/b&gt;");
    expect(html).toContain("Ingredients &lt;x&gt;");
    expect(html).toContain("Not &lt;advice&gt;");
  });

  it("reports an unavailable label when the product is unavailable", () => {
    expect(renderScreen({ toolName: "identify_product", arguments: {}, result: { available: false } })).toBe(
      '<p class="empty">I couldn\'t read that label.</p>'
    );
  });

  it("reports an unavailable label when there is no label text", () => {
    expect(renderScreen({ toolName: "identify_product", arguments: {}, result: { labelText: "" } })).toBe(
      '<p class="empty">I couldn\'t read that label.</p>'
    );
  });
});

describe("renderScreen: find_object", () => {
  it("renders the found object with an escaped location note", () => {
    const html = renderScreen({
      toolName: "find_object",
      arguments: {},
      result: { found: { name: "Keys", locationNote: "on the <hook>" } }
    });
    expect(html).toContain("Keys");
    expect(html).toContain("on the &lt;hook&gt;");
  });

  it("renders an unknown place when the location note is missing", () => {
    const html = renderScreen({ toolName: "find_object", arguments: {}, result: { found: { name: "Keys" } } });
    expect(html).toContain("an unknown place");
  });

  it("renders an empty state when nothing is found", () => {
    expect(renderScreen({ toolName: "find_object", arguments: {}, result: {} })).toBe(
      "<p class=\"empty\">I don't have a location for that.</p>"
    );
  });
});

describe("renderScreen: act_on_item", () => {
  it("renders the action and item card", () => {
    const html = renderScreen({
      toolName: "act_on_item",
      arguments: {},
      result: { action: { type: "Pay", status: "done" }, item: { readAloudText: "Paid <bill>" } }
    });
    expect(html).toContain("Pay · done");
    expect(html).toContain("card--info");
    expect(html).toContain("Paid &lt;bill&gt;");
  });
});

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

describe("renderConfirm", () => {
  it("renders exact Yes and Cancel buttons with the action id", () => {
    const html = renderConfirm({ actionId: "report", type: "Report" });
    expect(html).toContain('<button type="button" class="confirm__yes" data-action-id="report">Yes</button>');
    expect(html).toContain('<button type="button" class="confirm__no">Cancel</button>');
    expect(html).toContain('<section class="confirm" role="alertdialog" aria-label="Confirm action">');
    expect(html).toContain("Carry out <strong>Report</strong>?");
  });

  it("escapes a hostile action type and action id", () => {
    const html = renderConfirm({ actionId: '\'><img src=x onerror=alert(1)>', type: "<img src=x onerror=alert(1)>" });
    expect(html).toContain("Carry out <strong>&lt;img src=x onerror=alert(1)&gt;</strong>?");
    expect(html).toContain('data-action-id="&#39;&gt;&lt;img src=x onerror=alert(1)&gt;"');
    expect(html).not.toContain("<img");
  });
});

describe("renderScreen: fallbacks", () => {
  it("renders an empty state for unknown tools", () => {
    expect(renderScreen({ toolName: "mystery", arguments: {}, result: {} })).toBe(
      '<p class="empty">Nothing to show yet.</p>'
    );
  });

  it("renders an empty state for a malformed result", () => {
    expect(renderScreen({ toolName: "list_items", arguments: {}, result: undefined })).toBe(
      '<p class="empty">Nothing to show yet.</p>'
    );
  });
});
