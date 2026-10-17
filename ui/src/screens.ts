import { confidenceRing, ledgerChain, urgencyMeter } from "./viz.js";

export interface ScreenInput {
  toolName: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

type Dict = Record<string, unknown>;

const escape = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );

const own = (value: unknown): Dict => (value && typeof value === "object" ? (value as Dict) : {});
const listOf = (value: unknown): Dict[] => (Array.isArray(value) ? (value as Dict[]) : []);

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function formatAmount(amount: unknown): string {
  const a = own(amount);
  if (typeof a.value !== "number") return "";
  const currency = typeof a.currency === "string" ? a.currency : "";
  return `${currency} ${a.value.toFixed(2)}`.trim();
}

function confidenceOf(item: Dict): "high" | "low" {
  const record = own(item.record);
  if (record.confidence === "high" || record.confidence === "low") return record.confidence;
  const numeric = typeof item.confidence === "number" ? item.confidence : 1;
  return numeric >= 0.7 ? "high" : "low";
}

const EVENT_TEXT: Record<string, string> = {
  ingested: "Read the document",
  triaged: "Sorted the document",
  action_proposed: "Proposed an action",
  action_executed: "I carried out an action",
  action_confirmed: "You confirmed an action",
  action_refused: "I refused an action",
  delivery_failed: "A delivery failed",
  external_invoked: "Used an external service",
  superseded: "A newer document replaced this one",
  flag_raised: "Flagged as suspicious",
  escalated: "Escalated to your trusted contact",
  closed: "Closed the document"
};

const humanEvent = (event: string): string => EVENT_TEXT[event] ?? event;

const ICONS = {
  ok: "\u2713",
  warn: "!",
  alert: "\u2715",
  info: "\u2022"
} as const;

function pill(kind: string, label: string, icon: keyof typeof ICONS): string {
  return `<span class="pill pill--${kind}"><span class="pill__icon" aria-hidden="true">${ICONS[icon]}</span>${escape(label)}</span>`;
}

function facts(rows: Array<[string, string]>): string {
  const present = rows.filter(([, value]) => value !== "");
  if (!present.length) return "";
  return `<dl class="facts">${present
    .map(([term, value]) => `<div class="facts__row"><dt>${escape(term)}</dt><dd>${escape(value)}</dd></div>`)
    .join("")}</dl>`;
}

function screen(title: string, body: string): string {
  return `<section class="screen" aria-labelledby="wf-title"><h1 id="wf-title" class="screen__title">${escape(title)}</h1>${body}</section>`;
}

function emptyMessage(message: string): string {
  return `<p class="empty" role="status">${escape(message)}</p>`;
}

function emptyScreen(title: string, message: string): string {
  return screen(title, emptyMessage(message));
}

function confidencePill(item: Dict): string {
  return confidenceOf(item) === "high"
    ? pill("ok", "High confidence", "ok")
    : pill("warn", "Low confidence", "warn");
}

function confidenceValue(item: Dict): number {
  if (typeof item.confidence === "number" && Number.isFinite(item.confidence)) return item.confidence;
  return confidenceOf(item) === "high" ? 1 : 0.3;
}

function confidenceRingMark(item: Dict): string {
  const ring = confidenceRing(confidenceValue(item), 44);
  const centre = ring.size / 2;
  return `<span class="ring ring--${ring.low ? "low" : "high"}" aria-hidden="true"><svg viewBox="0 0 ${ring.size} ${ring.size}" width="${ring.size}" height="${ring.size}"><circle class="ring__track" cx="${centre}" cy="${centre}" r="${ring.radius}" fill="none" stroke-width="3"/><circle class="ring__value" cx="${centre}" cy="${centre}" r="${ring.radius}" fill="none" stroke-width="3" stroke-dasharray="${ring.circumference}" stroke-dashoffset="${ring.offset}" transform="rotate(-90 ${centre} ${centre})"/></svg><span class="ring__pct">${ring.percent}%</span></span>`;
}

function urgencyMeterMark(urgency: string): string {
  const meter = urgencyMeter(urgency);
  return `<span class="meter meter--${meter.kind}" aria-hidden="true"><span class="meter__fill"></span></span>`;
}

function urgencyPill(urgency: string): string {
  if (urgency === "high") return pill("alert", "High urgency", "alert");
  if (urgency === "medium") return pill("warn", "Medium urgency", "warn");
  return pill("quiet", "Low urgency", "info");
}

function itemFacts(item: Dict): string {
  const fields = own(item.fields);
  return facts([
    ["From", typeof fields.sender === "string" ? fields.sender : ""],
    ["Amount", formatAmount(fields.amount)],
    ["Due", typeof fields.dueDate === "string" ? fields.dueDate : ""],
    ["When", typeof fields.appointmentAt === "string" ? fields.appointmentAt : ""],
    ["Reference", typeof fields.reference === "string" ? fields.reference : ""],
    ["Account", typeof fields.maskedAccount === "string" ? fields.maskedAccount : ""]
  ]);
}

function actionButtons(item: Dict): string {
  const actions = listOf(item.proposedActions);
  if (!actions.length) return "";
  return `<div class="actions">${actions
    .map(
      (a) =>
        `<button type="button" class="action" data-item-id="${escape(item.itemId)}" data-action-id="${escape(a.actionId)}">${escape(a.type)}</button>`
    )
    .join("")}</div>`;
}

function docHead(item: Dict, level: 1 | 2): string {
  const cls = String(item.class ?? "document");
  const heading = `<h${level}>${escape(capitalize(cls))}</h${level}>`;
  const recapture = own(item.record).needsRecapture === true ? pill("warn", "Needs re-capturing", "warn") : "";
  return `<header class="doc__head">${confidenceRingMark(item)}<div class="doc__titles">${heading}<div class="doc__pills">${confidencePill(item)}${recapture}</div></div></header>`;
}

function docBody(item: Dict): string {
  const text = escape(item.readAloudText ?? "");
  return `${docHead(item, 2)}${text ? `<p class="doc__text">${text}</p>` : ""}${itemFacts(item)}${actionButtons(item)}`;
}

function documentCard(item: Dict): string {
  return `<li><article class="doc" data-item-id="${escape(item.itemId)}">${docBody(item)}</article></li>`;
}

function documentList(title: string, items: Dict[], emptyMessage: string): string {
  if (!items.length) return emptyScreen(title, emptyMessage);
  return screen(title, `<ul class="docs" aria-label="${escape(title)}">${items.map(documentCard).join("")}</ul>`);
}

function documentDetail(item: Dict): string {
  const record = own(item.record);
  const confirmation = own(record.confirmation);
  const detail = typeof confirmation.detail === "string" ? confirmation.detail : "";
  const confirmationBlock = detail
    ? `<p class="confirmation" role="status"><strong>Confirmed</strong> ${escape(detail)}</p>`
    : "";
  const lifecycle = typeof record.lifecycle === "string" ? record.lifecycle.replace(/_/g, " ") : "";
  return screen(
    capitalize(String(item.class ?? "document")),
    `<article class="doc doc--detail" data-item-id="${escape(item.itemId)}">${docHead(item, 2)}${itemFacts(item)}<p class="doc__text">${escape(item.readAloudText ?? "")}</p>${confirmationBlock}${lifecycle ? `<p class="meta">Status: ${escape(lifecycle)}</p>` : ""}${actionButtons(item)}</article>`
  );
}

function itemLine(item: Dict): string {
  const fields = own(item.fields);
  const sender = typeof fields.sender === "string" ? `${fields.sender}: ` : "";
  const text = typeof item.readAloudText === "string" ? item.readAloudText : String(item.itemId ?? "");
  const due = typeof fields.dueDate === "string" ? ` · due ${fields.dueDate}` : "";
  const when = typeof fields.appointmentAt === "string" ? ` · ${fields.appointmentAt}` : "";
  return `<li>${escape(`${sender}${text}${due}${when}`)}</li>`;
}

function todaySection(title: string, items: Dict[]): string {
  if (!items.length) return "";
  return `<section class="today__group"><h2>${escape(title)}</h2><ul class="lines">${items.map(itemLine).join("")}</ul></section>`;
}

function renderToday(result: Dict): string {
  const backlog = listOf(result.backlog).filter((e) => own(e.thread).outstanding === true);
  const due = listOf(result.due);
  const appointments = listOf(result.appointments);
  const flagged = listOf(result.flagged);
  const objects = listOf(result.objectReminders);
  const groups = [
    todaySection("Appointments", appointments),
    todaySection("Due", due),
    todaySection("Flagged", flagged),
    objects.length
      ? `<section class="today__group"><h2>Reminders</h2><ul class="lines">${objects
          .map((o) => `<li>${escape(`${String(o.name ?? "item")} — last seen ${String(o.locationNote ?? "an unknown place")}`)}</li>`)
          .join("")}</ul></section>`
      : ""
  ].join("");
  if (!groups) return screen("Today", emptyMessage("Nothing needs your attention today."));
  const top = backlog[0];
  const lead = top ? `<p class="lead">Most urgent: ${escape(describeThread(own(top.thread), top.deadline))}</p>` : "";
  return screen("Today", `${lead}${groups}`);
}

function describeThread(thread: Dict, deadline: unknown): string {
  const who = typeof thread.sender === "string" && thread.sender ? thread.sender : "an unknown sender";
  const demandType = typeof thread.demandType === "string" ? thread.demandType : "none";
  const what = demandType === "none" ? "a document" : `${demandType === "appointment" ? "an" : "a"} ${demandType}`;
  const when = deadline !== undefined && deadline !== "" ? ` due ${String(deadline)}` : "";
  const reminders = Number(thread.reminderCount ?? 0);
  const remind = reminders > 0 ? `, ${plural(reminders, "reminder")}` : "";
  return `${who}: ${what}${when}${remind}`;
}

function threadCard(entry: Dict): string {
  const thread = own(entry.thread);
  const urgency = String(thread.urgency ?? "low");
  const sender = typeof thread.sender === "string" && thread.sender ? thread.sender : "Unknown sender";
  const demandType = typeof thread.demandType === "string" && thread.demandType !== "none" ? thread.demandType : "document";
  const reminders = Number(thread.reminderCount ?? 0);
  const documents = listOf(entry.documents);
  const meta = [
    entry.deadline !== undefined && entry.deadline !== "" ? `due ${String(entry.deadline)}` : "",
    reminders > 0 ? plural(reminders, "reminder") : "",
    plural(documents.length, "document")
  ]
    .filter(Boolean)
    .join(" · ");
  const docs = documents.length
    ? `<details class="thread__docs"><summary>${escape(plural(documents.length, "document"))}</summary><ul class="lines">${documents
        .map((d) => `<li>${escape(String(d.readAloudText ?? d.itemId ?? "document"))}</li>`)
        .join("")}</ul></details>`
    : "";
  return `<li class="thread"><article><header class="thread__head"><h2>${escape(`${sender} · ${demandType}`)}</h2><div class="thread__tags">${urgencyPill(urgency)}${urgencyMeterMark(urgency)}</div></header><p class="meta">${escape(meta)}</p>${docs}<div class="actions"><button type="button" class="view-history" data-thread-key="${escape(thread.threadKey)}">View history</button></div></article></li>`;
}

function renderBacklog(result: Dict): string {
  const backlog = listOf(result.backlog);
  if (!backlog.length) return emptyScreen("Backlog", "Nothing is waiting on you right now.");
  return screen("Backlog", `<ol class="threads">${backlog.map(threadCard).join("")}</ol>`);
}

function entryRow(entry: Dict): string {
  const event = String(entry.event ?? "event");
  const actor = String(entry.actor ?? "");
  const when = String(entry.at ?? "");
  const details = entry.details !== undefined && Object.keys(own(entry.details)).length ? own(entry.details) : null;
  const meta = [actor === "user" ? "You" : actor === "agent" ? "Wayfinder" : actor, when].filter(Boolean).join(" · ");
  const detailBlock = details
    ? `<details class="timeline__details"><summary>Details</summary><code>${escape(JSON.stringify(details))}</code> <span class="timeline__raw">${escape(event)}</span></details>`
    : `<span class="timeline__raw">${escape(event)}</span>`;
  return `<li class="timeline__item"><p class="timeline__event">${escape(humanEvent(event))}</p><p class="timeline__meta">${escape(meta)}</p>${detailBlock}</li>`;
}

function renderHistory(result: Dict): string {
  const entries = listOf(result.entries);
  if (!entries.length) return emptyScreen("History", "I have no record of that.");
  return screen("History", `<ol class="timeline">${entries.map(entryRow).join("")}</ol>`);
}

function chainMark(entries: number, ok: boolean): string {
  const blocks = ledgerChain(entries);
  const glyphs = blocks
    .filter((block) => !block.ellipsis)
    .map(() => `<span class="chain__block"></span>`)
    .join("");
  const more = blocks.some((block) => block.ellipsis) ? `<span class="chain__more">…</span>` : "";
  const cap = ok
    ? `<span class="chain__seal" aria-hidden="true">${ICONS.ok}</span>`
    : `<span class="chain__break" aria-hidden="true">${ICONS.alert}</span>`;
  return `<div class="chain chain--${ok ? "verified" : "broken"}" aria-hidden="true">${glyphs}${more}${cap}</div>`;
}

function renderVerification(result: Dict): string {
  if (typeof result.ok !== "boolean") return emptyScreen("Verification", "Nothing to verify yet.");
  const entries = typeof result.entries === "number" ? result.entries : 0;
  const terminal = typeof result.terminal === "string" ? result.terminal : "";
  const recheck = `<div class="actions"><button type="button" class="recheck">Check again</button></div>`;
  const chain = chainMark(entries, result.ok);
  if (result.ok) {
    const hash = terminal
      ? `<p class="verify__hash"><span class="verify__label">Final fingerprint</span><code class="hash">${escape(terminal)}</code><button type="button" class="copy" data-copy="${escape(terminal)}">Copy</button></p>`
      : "";
    return screen(
      "Verification",
      `<section class="verify verify--ok" role="status"><h2 class="verify__head"><span class="verify__icon" aria-hidden="true">${ICONS.ok}</span>Chain verified</h2><p class="verify__count">${escape(plural(entries, "entry", "entries"))}</p>${chain}${hash}${recheck}</section>`
    );
  }
  return screen(
    "Verification",
    `<section class="verify verify--bad" role="alert"><h2 class="verify__head"><span class="verify__icon" aria-hidden="true">${ICONS.alert}</span>Record does not verify</h2><p class="verify__count">Entry ${escape(result.firstMismatchSeq ?? "?")} was changed.</p>${chain}${recheck}</section>`
  );
}

function renderLabel(result: Dict): string {
  if (result.available === false || !result.labelText) return emptyScreen("Label", "I couldn't read that label.");
  return screen(
    typeof result.name === "string" && result.name ? result.name : "Label",
    `<article class="doc doc--label"><h2>${escape(result.name ?? "Label")}</h2><pre class="label">${escape(result.labelText ?? "")}</pre><p class="disclaimer">${escape(result.disclaimer ?? "")}</p></article>`
  );
}

function renderObject(result: Dict): string {
  const found = result.found;
  if (!found || typeof found !== "object") return emptyScreen("Object", "I don't have a location for that.");
  const obj = own(found);
  const place = typeof obj.locationNote === "string" && obj.locationNote ? obj.locationNote : "an unknown place";
  return screen("Object", `<article class="doc"><h2 class="doc__name">${escape(obj.name ?? "Object")}</h2><p>Last seen ${escape(place)}</p></article>`);
}

function refusalCard(decision: string, message: string, item: Dict): string {
  const heading = decision === "escalate" ? "Needs help" : "Not allowed";
  const reason = `<p>${escape(message)}</p>`;
  const who = own(item.fields).sender;
  const context = typeof who === "string" && who ? `<p class="meta">${escape(who)}</p>` : "";
  if (decision === "escalate") {
    return `<section class="card card--alert refusal" role="alert"><h2>${escape(heading)}</h2>${context}${reason}</section>`;
  }
  const documentId = item.itemId !== undefined ? String(item.itemId) : "";
  const attr = documentId ? ` data-document-id="${escape(documentId)}"` : "";
  return `<section class="card card--alert refusal" role="alert"><h2>${escape(heading)}</h2>${context}${reason}<div class="actions"><button type="button" class="escalate"${attr}>Ask my trusted contact to help</button></div></section>`;
}

function renderAction(result: Dict): string {
  if (result.failed === true) return emptyScreen("Action", "I couldn't do that — please choose the action again.");
  const decision = String(result.decision ?? "allow");
  const action = own(result.action);
  const item = own(result.item);
  if (decision === "refuse" || decision === "escalate") {
    return screen("Action", refusalCard(decision, String(result.message ?? ""), item));
  }
  const status = action.status ? ` · ${action.status}` : "";
  const sender = own(item.fields).sender;
  const senderLine = typeof sender === "string" && sender ? `<p class="meta">${escape(sender)}</p>` : "";
  return screen(String(action.type ?? "Done"), `<section class="card card--info" role="status"><h2>${escape(`${String(action.type ?? "Done")}${status}`)}</h2>${senderLine}<p>${escape(item.readAloudText ?? "")}</p></section>`);
}

function renderEscalation(result: Dict): string {
  if (result.failed === true) return emptyScreen("Escalated", "I couldn't reach your trusted contact.");
  const alias = typeof result.alias === "string" && result.alias ? result.alias : "your trusted contact";
  return screen("Escalated", `<section class="card card--info" role="status"><h2>Escalated</h2><p>I've asked ${escape(alias)} to help with that.</p></section>`);
}

export function renderPending(label = "Working…"): string {
  return `<div class="skeleton" role="status"><span class="sr-only">${escape(label)}</span></div>`;
}

export function renderConfirm(action: { actionId: string; type: string }): string {
  return `<section class="confirm" role="alertdialog" aria-modal="true" aria-labelledby="wf-confirm-title"><h2 id="wf-confirm-title">Confirm action</h2><p>Carry out <strong>${escape(action.type)}</strong>?</p><div class="confirm__actions"><button type="button" class="confirm__yes" data-action-id="${escape(action.actionId)}">Yes</button><button type="button" class="confirm__no">No</button></div></section>`;
}

export function renderScreen(input: ScreenInput): string {
  const result = own(input.result);
  const items = listOf(result.items);

  switch (input.toolName) {
    case "get_scan":
    case "list_items":
      return documentList("Documents", items, "Nothing to show yet.");
    case "get_item":
      return result.item ? documentDetail(own(result.item)) : emptyScreen("Document", "No item.");
    case "get_backlog":
      return renderBacklog(result);
    case "get_audit":
      return renderHistory(result);
    case "verify_ledger":
      return renderVerification(result);
    case "daily_briefing":
      return renderToday(result);
    case "identify_product":
      return renderLabel(result);
    case "act_on_item":
      return renderAction(result);
    case "escalate_item":
      return renderEscalation(result);
    case "find_object":
      return renderObject(result);
    default:
      return emptyScreen("Wayfinder", "Nothing to show yet.");
  }
}
