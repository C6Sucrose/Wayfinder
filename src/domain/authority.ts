import type { ActionType, Authority, DocumentRecord } from "./model.js";

export type ActionKind =
  | "make_payment" | "share_personal_data" | "delete_document" | "discard_document" | "other";

export function kindFor(actionType: ActionType): ActionKind {
  switch (actionType) {
    case "share": return "share_personal_data";
    case "discard": return "discard_document";
    default: return "other";
  }
}

export function evaluateAuthority(input: {
  actionType: ActionType;
  amount?: { currency: string; value: number };
  record: DocumentRecord;
  authority: Authority;
}): { decision: "allow" | "confirm" | "refuse"; reason: string } {
  const { actionType, amount, record, authority } = input;

  if (record.record.confidence === "low") {
    if (authority.onLowConfidence === "refuse") {
      return { decision: "refuse", reason: "I can't read this reliably, so I won't act on it." };
    }
    if (authority.onLowConfidence === "escalate") {
      return { decision: "refuse", reason: "I can't read this reliably; I'll ask your trusted contact to help." };
    }
    return { decision: "confirm", reason: "I'm not certain I read this correctly — please confirm." };
  }

  const kind = kindFor(actionType);
  if (kind !== "other" && authority.forbidden.includes(kind)) {
    return { decision: "refuse", reason: `You have not allowed me to ${kind.replace(/_/g, " ")}.` };
  }

  if (amount) {
    if (amount.value >= authority.confirmAbove.value || amount.value > authority.autoActUpTo.value) {
      return { decision: "confirm", reason: "This is above the amount I can act on without asking." };
    }
  }

  return { decision: "allow", reason: "" };
}
