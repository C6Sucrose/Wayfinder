import type { Fields } from "./model.js";
import { amountSane, datePlausible, ibanIsValid } from "./validity.js";

export interface ReadbackAssessment {
  confidence: "high" | "low";
  needsRecapture: boolean;
  reasons: string[];
}

const IBAN_CANDIDATE = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/gi;

export function assessReadback(input: {
  text: string;
  fields: Fields;
  history?: number[];
  now: Date;
}): ReadbackAssessment {
  const reasons: string[] = [];

  for (const candidate of input.text.match(IBAN_CANDIDATE) ?? []) {
    if (!ibanIsValid(candidate)) reasons.push("account");
  }
  if (input.fields.dueDate !== undefined && !datePlausible(input.fields.dueDate, input.now)) {
    reasons.push("dueDate");
  }
  if (input.fields.amount !== undefined && !amountSane(input.fields.amount, input.history)) {
    reasons.push("amount");
  }

  const unique = [...new Set(reasons)];
  return {
    confidence: unique.length === 0 ? "high" : "low",
    needsRecapture: unique.length > 0,
    reasons: unique
  };
}
