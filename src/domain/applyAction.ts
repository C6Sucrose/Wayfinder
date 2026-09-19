import type { Store } from "../storage/types.js";
import type { Action, Item } from "./model.js";

export interface ApplyResult {
  item: Item;
  action: Action;
  message: string;
}

export async function applyAction(store: Store, itemId: string, actionId: string): Promise<ApplyResult> {
  const item = await store.getItem(itemId);
  if (!item) throw new Error("Unknown item.");
  const action = item.proposedActions.find((a) => a.actionId === actionId);
  if (!action) throw new Error("Unknown action.");

  if (action.status === "done" || action.status === "confirmed") {
    await store.putAction(action);
    return { item, action, message: "That's already done." };
  }

  if (action.type === "remind" && typeof action.params.on !== "string") {
    throw new Error("This reminder has no date.");
  }
  if (action.type === "schedule" && typeof action.params.at !== "string") {
    throw new Error("This appointment has no time.");
  }

  const preferences = await store.getPreferences();
  const now = new Date().toISOString();
  let resolvedAt = item.resolvedAt;
  let message: string;

  switch (action.type) {
    case "remind": message = "I'll remind you about that."; break;
    case "schedule": message = "I've added that to your calendar."; break;
    case "flag": message = "I've flagged that for you."; break;
    case "file": resolvedAt = now; message = "Filed."; break;
    case "discard": resolvedAt = now; message = "Discarded."; break;
    case "share":
      if (!preferences.trustedContactAlias) throw new Error("No trusted contact is set up.");
      message = `Shared with ${preferences.trustedContactAlias}.`;
      break;
  }

  const done: Action = { ...action, status: "done" };
  const updatedItem: Item = {
    ...item,
    resolvedAt,
    proposedActions: item.proposedActions.map((a) => (a.actionId === action.actionId ? done : a))
  };
  await store.putItem(updatedItem);
  await store.putAction(done);
  return { item: updatedItem, action: done, message };
}
