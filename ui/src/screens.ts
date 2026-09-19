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
    ? `<ul class="actions">${(item.proposedActions as Array<Record<string, unknown>>)
        .map((a) => `<li>${escape(a.type)}</li>`)
        .join("")}</ul>`
    : "";
  return card(`${cls}${due ? ` · due ${due}` : ""}`, `<p>${text}</p>${actions}`, tone);
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
    case "daily_briefing": {
      const due = Array.isArray(result.due) ? result.due.length : 0;
      const flagged = Array.isArray(result.flagged) ? result.flagged.length : 0;
      const appts = Array.isArray(result.appointments) ? result.appointments.length : 0;
      return `<section class="grid">${card("Due", `<p class="big">${due}</p>`)}${card("Appointments", `<p class="big">${appts}</p>`)}${card("Flagged", `<p class="big">${flagged}</p>`, flagged ? "alert" : "")}</section>`;
    }
    case "identify_product":
      return card(String(result.name ?? "Label"), `<pre class="label">${escape(result.labelText ?? "")}</pre><p class="disclaimer">${escape(result.disclaimer ?? "")}</p>`);
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
