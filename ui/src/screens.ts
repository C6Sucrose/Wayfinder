export interface ScreenInput {
  toolName: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

const escape = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );

function card(title: string, body: string, tone = ""): string {
  return `<article class="card${tone ? ` card--${tone}` : ""}"><h2>${escape(title)}</h2><div class="card__body">${body}</div></article>`;
}

function itemCard(item: Record<string, unknown>): string {
  const cls = String(item.class ?? "item");
  const text = escape(item.readAloudText ?? "");
  const due = item.fields && typeof item.fields === "object" && "dueDate" in (item.fields as object)
    ? (item.fields as Record<string, unknown>).dueDate
    : "";
  const tone = cls === "scam" ? "alert" : cls === "label" ? "info" : "";
  const actions = Array.isArray(item.proposedActions)
    ? `<div class="actions">${(item.proposedActions as Array<Record<string, unknown>>)
        .map((a) => `<button type="button" class="action" data-item-id="${escape(item.itemId)}" data-action-id="${escape(a.actionId)}">${escape(a.type)}</button>`)
        .join("")}</div>`
    : "";
  return card(`${cls}${due ? ` · due ${due}` : ""}`, `<p>${text}</p>${actions}`, tone);
}

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

export function renderConfirm(action: { actionId: string; type: string }): string {
  return `<section class="confirm" role="alertdialog" aria-label="Confirm action"><p>Carry out <strong>${escape(action.type)}</strong>?</p><div class="confirm__actions"><button type="button" class="confirm__yes" data-action-id="${escape(action.actionId)}">Yes</button><button type="button" class="confirm__no">Cancel</button></div></section>`;
}

export function renderScreen(input: ScreenInput): string {
  const result = (input.result ?? {}) as Record<string, unknown>;
  const items = Array.isArray(result.items) ? (result.items as Array<Record<string, unknown>>) : [];

  switch (input.toolName) {
    case "get_scan":
    case "list_items":
      return items.length
        ? `<section class="grid">${items.map(itemCard).join("")}</section>`
        : `<p class="empty">Nothing to show yet.</p>`;
    case "get_item":
      return result.item ? itemCard(result.item as Record<string, unknown>) : `<p class="empty">No item.</p>`;
    case "get_backlog": {
      const backlog = Array.isArray(result.backlog) ? (result.backlog as Array<Record<string, unknown>>) : [];
      return backlog.length
        ? `<section class="grid">${backlog.map(threadCard).join("")}</section>`
        : `<p class="empty">Nothing is waiting on you right now.</p>`;
    }
    case "daily_briefing": {
      const due = Array.isArray(result.due) ? result.due.length : 0;
      const flagged = Array.isArray(result.flagged) ? result.flagged.length : 0;
      const appts = Array.isArray(result.appointments) ? result.appointments.length : 0;
      const reminders = Array.isArray(result.objectReminders) ? result.objectReminders.length : 0;
      return `<section class="grid">${card("Due", `<p class="big">${due}</p>`)}${card("Appointments", `<p class="big">${appts}</p>`)}${card("Flagged", `<p class="big">${flagged}</p>`, flagged ? "alert" : "")}${card("Reminders", `<p class="big">${reminders}</p>`, reminders ? "info" : "")}</section>`;
    }
    case "identify_product":
      if (result.available === false || !result.labelText) return `<p class="empty">I couldn't read that label.</p>`;
      return card(String(result.name ?? "Label"), `<pre class="label">${escape(result.labelText ?? "")}</pre><p class="disclaimer">${escape(result.disclaimer ?? "")}</p>`);
    case "act_on_item": {
      const action = (result.action ?? {}) as Record<string, unknown>;
      const item = (result.item ?? {}) as Record<string, unknown>;
      const status = action.status ? ` · ${action.status}` : "";
      return card(`${String(action.type ?? "Done")}${status}`, `<p>${escape(item.readAloudText ?? "")}</p>`, "info");
    }
    case "find_object": {
      const found = result.found as Record<string, unknown> | null | undefined;
      return found
        ? card(String(found.name ?? "Object"), `<p>Last seen ${found.locationNote ? escape(found.locationNote) : "an unknown place"}</p>`)
        : `<p class="empty">I don't have a location for that.</p>`;
    }
    default:
      return `<p class="empty">Nothing to show yet.</p>`;
  }
}
