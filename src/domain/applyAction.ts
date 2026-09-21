import type { Store } from "../storage/types.js";
import type { Action, Item, LedgerEntry } from "./model.js";
import { copy } from "./copy.js";
import { DEFAULT_AUTHORITY, evaluateAuthority, type AuthorityDecision } from "./authority.js";
import { toDocumentRecord } from "./correlation.js";
import { withLifecycle } from "./lifecycle.js";
import { createLedger } from "./ledgerLog.js";

export interface ApplyResult {
  item: Item;
  action: Action;
  message: string;
  decision: AuthorityDecision;
  receipt?: LedgerEntry;
}

export interface ApplyOptions {
  confirmed?: boolean;
}

const CLOSING_ACTIONS: ReadonlySet<Action["type"]> = new Set(["file", "discard"]);

export async function applyAction(
  store: Store,
  itemId: string,
  actionId: string,
  options: ApplyOptions = {}
): Promise<ApplyResult> {
  const item = await store.getItem(itemId);
  if (!item) throw new Error("Unknown item.");
  const action = item.proposedActions.find((a) => a.actionId === actionId);
  if (!action) throw new Error("Unknown action.");

  if (action.status === "done" || action.status === "confirmed") {
    await store.putAction(action);
    return { item, action, message: copy.actions.alreadyDone, decision: "allow" };
  }

  if (action.type === "remind" && typeof action.params.on !== "string") {
    throw new Error("This reminder has no date.");
  }
  if (action.type === "schedule" && typeof action.params.at !== "string") {
    throw new Error("This appointment has no time.");
  }

  const preferences = await store.getPreferences();
  const authority = preferences.authority ?? DEFAULT_AUTHORITY;
  const record = toDocumentRecord(item);
  const verdict = evaluateAuthority({
    actionType: action.type,
    ...(item.fields.amount !== undefined ? { amount: item.fields.amount } : {}),
    record,
    authority
  });

  const ledger = createLedger(store);
  const now = new Date().toISOString();

  if (verdict.decision === "refuse" || verdict.decision === "escalate") {
    const receipt = await ledger.append({
      at: now,
      actor: "agent",
      event: verdict.decision === "escalate" ? "escalated" : "action_refused",
      documentId: item.itemId,
      threadKey: record.record.threadKey,
      details: { actionType: action.type, reason: verdict.reason }
    });
    return { item, action, message: verdict.reason, decision: verdict.decision, receipt };
  }

  if (verdict.decision === "confirm" && options.confirmed !== true) {
    const receipt = await ledger.append({
      at: now,
      actor: "agent",
      event: "action_proposed",
      documentId: item.itemId,
      threadKey: record.record.threadKey,
      details: { actionType: action.type, reason: verdict.reason }
    });
    return { item, action, message: verdict.reason, decision: "confirm", receipt };
  }

  let message: string;
  switch (action.type) {
    case "remind": message = copy.actions.remind; break;
    case "schedule": message = copy.actions.schedule; break;
    case "flag": message = copy.actions.flag; break;
    case "file": message = copy.actions.file; break;
    case "discard": message = copy.actions.discard; break;
    case "share":
      if (!preferences.trustedContactAlias) throw new Error("No trusted contact is set up.");
      message = copy.actions.share(preferences.trustedContactAlias);
      break;
  }

  const receipt = await ledger.append({
    at: now,
    actor: verdict.decision === "allow" ? "agent" : "user",
    event: verdict.decision === "allow" ? "action_executed" : "action_confirmed",
    documentId: item.itemId,
    threadKey: record.record.threadKey,
    details: { actionType: action.type }
  });

  const done: Action = { ...action, status: "done" };
  const updatedItem = withLifecycle(
    { ...item, proposedActions: item.proposedActions.map((a) => (a.actionId === action.actionId ? done : a)) },
    CLOSING_ACTIONS.has(action.type) ? "closed" : "action_taken",
    now
  );
  try {
    await store.putItem(updatedItem);
    await store.putAction(done);
  } catch (err) {
    try {
      await ledger.append({
        at: now,
        actor: "agent",
        event: "delivery_failed",
        documentId: item.itemId,
        threadKey: record.record.threadKey,
        details: { actionType: action.type }
      });
    } catch (logErr) {
      console.error("[applyAction] failed to record delivery_failed:", logErr);
    }
    throw err;
  }
  return { item: updatedItem, action: done, message, decision: verdict.decision, receipt };
}
