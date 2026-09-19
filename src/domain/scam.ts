import type { Signals } from "./classifier.js";

export interface ScamResult {
  riskScore: number;
  band: "low" | "medium" | "high";
  reasons: string[];
}

const URGENCY = /\b(?:urgent|urgently|immediately|within \d+ hours|final notice|act now|arrest|suspend(?:ed)?)\b/i;
const GIFT = /\b(?:gift cards?|itunes card|google play card|voucher code)\b/i;

export function scoreScam(text: string, signals: Signals): ScamResult {
  let score = 0;
  const reasons: string[] = [];
  const urgent = URGENCY.test(text);
  const gift = GIFT.test(text);
  // A bare payment request is normal on bills; only weight it when corroborated.
  const corroboratedPayment = signals.hasPaymentRequest && (signals.hasQrOrLink || signals.senderMismatch || gift);
  if (corroboratedPayment) { score += 0.3; reasons.push("requests a payment in a suspicious context"); }
  if (signals.hasQrOrLink) { score += 0.15; reasons.push("includes a link or QR code"); }
  if (signals.senderMismatch) { score += 0.25; reasons.push("sender does not match the claimed organisation"); }
  if (signals.genericSalutation) { score += 0.15; reasons.push("uses a generic greeting often seen in scam mail"); }
  if (urgent) { score += 0.2; reasons.push("uses urgency or threats"); }
  if (gift) { score += 0.3; reasons.push("asks for gift-card payment"); }
  score = Math.round(Math.min(1, score) * 100) / 100;
  const band = score >= 0.6 ? "high" : score >= 0.35 ? "medium" : "low";
  return { riskScore: score, band, reasons };
}
