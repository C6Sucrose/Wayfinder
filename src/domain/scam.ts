import type { Signals } from "./classifier.js";

export interface ScamResult {
  riskScore: number;
  band: "low" | "medium" | "high";
  reasons: string[];
}

const URGENCY = /urgent|immediately|within \d+ hours|final notice|act now|arrest|suspend/i;
const GIFT = /gift card|itunes card|google play card|voucher code/i;

export function scoreScam(text: string, signals: Signals): ScamResult {
  let score = 0;
  const reasons: string[] = [];
  if (signals.hasPaymentRequest) { score += 0.3; reasons.push("requests a payment"); }
  if (signals.hasQrOrLink) { score += 0.15; reasons.push("includes a link or QR code"); }
  if (signals.senderMismatch) { score += 0.25; reasons.push("sender does not match the claimed organisation"); }
  if (URGENCY.test(text)) { score += 0.2; reasons.push("uses urgency or threats"); }
  if (GIFT.test(text)) { score += 0.3; reasons.push("asks for gift-card payment"); }
  score = Math.min(1, score);
  const band = score >= 0.6 ? "high" : score >= 0.35 ? "medium" : "low";
  return { riskScore: score, band, reasons };
}
