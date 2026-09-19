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
    default: {
      const unhandled: never = item.class;
      throw new Error(`Unhandled document class: ${String(unhandled)}`);
    }
  }
  return out;
}
