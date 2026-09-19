import type { DocClass } from "./model.js";

export interface Signals {
  hasQrOrLink: boolean;
  hasPaymentRequest: boolean;
  senderMismatch: boolean;
}

interface Rule { cls: DocClass; patterns: RegExp[]; weight: number; reason: string }

const RULES: Rule[] = [
  { cls: "bill", weight: 1, reason: "mentions an amount due or payment due",
    patterns: [/amount due/i, /payment due/i, /invoice/i, /rechnung/i, /please pay/i] },
  { cls: "appointment", weight: 1, reason: "mentions a scheduled appointment",
    patterns: [/appointment/i, /scheduled for/i, /termin/i, /your visit/i] },
  { cls: "insurance", weight: 1, reason: "mentions a policy or claim",
    patterns: [/policy/i, /claim/i, /coverage/i, /insurance/i, /versicherung/i] },
  { cls: "government", weight: 1, reason: "mentions tax or an authority",
    patterns: [/tax/i, /finanzamt/i, /authority/i, /benefits/i, /steuer/i] },
  { cls: "receipt", weight: 1, reason: "looks like a purchase receipt",
    patterns: [/thank you for your purchase/i, /receipt/i, /total\s*[:€$]/i] },
  { cls: "label", weight: 1, reason: "looks like a product or food label",
    patterns: [/ingredients/i, /best before/i, /use by/i, /allergen/i] },
];

export function classifyText(text: string, signals: Signals): { class: DocClass; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let scamScore = 0;
  if (signals.hasPaymentRequest) { scamScore += 2; reasons.push("asks for a payment"); }
  if (signals.hasQrOrLink) { scamScore += 1; reasons.push("contains a link or QR code"); }
  if (signals.senderMismatch) { scamScore += 2; reasons.push("sender does not match the claimed organisation"); }
  if (/urgent|immediately|gift card|arrest|final notice/i.test(text)) { scamScore += 2; reasons.push("uses urgent or threatening language"); }
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
