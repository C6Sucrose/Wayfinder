import type { DocClass } from "./model.js";

export interface Signals {
  hasQrOrLink: boolean;
  hasPaymentRequest: boolean;
  senderMismatch: boolean;
}

interface Rule { cls: DocClass; patterns: RegExp[]; weight: number; reason: string }

const URGENCY = /\b(?:urgent|urgently|immediately|within \d+ hours|final notice|act now|arrest|suspend(?:ed)?)\b/i;
const GIFT = /\b(?:gift cards?|itunes card|google play card|voucher code)\b/i;

const RULES: Rule[] = [
  { cls: "bill", weight: 1, reason: "mentions an amount due or payment due",
    patterns: [/amount due/i, /payment due/i, /\binvoice\b/i, /\brechnung\b/i, /please pay/i] },
  { cls: "appointment", weight: 1, reason: "mentions a scheduled appointment",
    patterns: [/\bappointment\b/i, /scheduled for/i, /\btermin\b/i, /your visit/i] },
  { cls: "insurance", weight: 1, reason: "mentions a policy or claim",
    patterns: [/\bpolicy\b/i, /\bclaim\b/i, /\bcoverage\b/i, /\binsurance\b/i, /\bversicherung\b/i] },
  { cls: "government", weight: 1, reason: "mentions tax or an authority",
    patterns: [/\btax\b/i, /\bfinanzamt\b/i, /\bauthority\b/i, /\bbenefits\b/i, /\bsteuer\b/i] },
  { cls: "receipt", weight: 1, reason: "looks like a purchase receipt",
    patterns: [/thank you for your purchase/i, /\breceipt\b/i, /total\s*[:€$]/i] },
  { cls: "label", weight: 1, reason: "looks like a product or food label",
    patterns: [/\bingredients\b/i, /best before/i, /use by/i, /\ballergen\b/i] },
];

export function classifyText(text: string, signals: Signals): { class: DocClass; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  const urgent = URGENCY.test(text);
  const gift = GIFT.test(text);
  // A bare payment request is normal on bills; only treat it as a scam signal
  // when corroborated by a link/QR, a sender mismatch, or gift-card language.
  const corroboratedPayment = signals.hasPaymentRequest && (signals.hasQrOrLink || signals.senderMismatch || gift);

  let scamScore = 0;
  if (corroboratedPayment) { scamScore += 2; reasons.push("asks for a payment in a suspicious context"); }
  if (signals.hasQrOrLink) { scamScore += 1; reasons.push("contains a link or QR code"); }
  if (signals.senderMismatch) { scamScore += 2; reasons.push("sender does not match the claimed organisation"); }
  if (urgent) { scamScore += 2; reasons.push("uses urgent or threatening language"); }
  if (gift) { scamScore += 2; reasons.push("asks for gift-card payment"); }
  if (scamScore >= 3) {
    return { class: "scam", confidence: Math.min(0.95, 0.5 + scamScore * 0.1), reasons };
  }

  let best: { cls: DocClass; hits: number; reasons: string[] } | null = null;
  for (const rule of RULES) {
    const hits = rule.patterns.filter((p) => p.test(text)).length;
    if (hits > 0 && (!best || hits > best.hits)) {
      best = { cls: rule.cls, hits, reasons: [rule.reason] };
    }
  }
  if (best) {
    return { class: best.cls, confidence: Math.min(0.9, 0.5 + best.hits * 0.15), reasons: best.reasons };
  }

  if (/\bhi\b|\bdear\b|\bhello\b/i.test(text)) {
    return { class: "personal", confidence: 0.4, reasons: ["addresses the reader personally"] };
  }
  return { class: "junk", confidence: 0.3, reasons: ["no recognisable document patterns"] };
}
