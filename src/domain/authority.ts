import { copy } from "./copy.js";
import type { ActionType, Authority, DocumentRecord } from "./model.js";

export type ActionKind =
  | "make_payment" | "share_personal_data" | "delete_document" | "discard_document" | "other";

export type AuthorityDecision = "allow" | "confirm" | "refuse" | "escalate";

export const DEFAULT_AUTHORITY: Authority = {
  autoActUpTo: { currency: "EUR", value: 0 },
  confirmAbove: { currency: "EUR", value: 0 },
  forbidden: [],
  onLowConfidence: "ask"
};

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
}): { decision: AuthorityDecision; reason: string } {
  const { actionType, amount, record, authority } = input;

  const kind = kindFor(actionType);
  if (kind !== "other" && authority.forbidden.includes(kind)) {
    return { decision: "refuse", reason: copy.authority.forbidden(kind) };
  }

  if (record.record.confidence === "low") {
    if (authority.onLowConfidence === "refuse") {
      return { decision: "refuse", reason: copy.authority.lowConfidenceRefuse };
    }
    if (authority.onLowConfidence === "escalate") {
      return { decision: "escalate", reason: copy.authority.lowConfidenceEscalate };
    }
    return { decision: "confirm", reason: copy.authority.lowConfidenceConfirm };
  }

  if (amount) {
    if (amount.currency !== authority.confirmAbove.currency || amount.currency !== authority.autoActUpTo.currency) {
      return {
        decision: "confirm",
        reason: copy.authority.currencyConfirm(
          amount.currency,
          authority.confirmAbove.currency,
          authority.autoActUpTo.currency
        )
      };
    }
    if (amount.value >= authority.confirmAbove.value || amount.value > authority.autoActUpTo.value) {
      return { decision: "confirm", reason: copy.authority.amountConfirm };
    }
  }

  return { decision: "allow", reason: "" };
}
