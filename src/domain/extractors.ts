import type { DocClass, Fields } from "./model.js";
import { maskAccount, redactSensitive } from "./redact.js";

export { maskAccount } from "./redact.js";

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12"
};

function normalizeAmount(raw: string): number {
  const cleaned = raw.replace(/\s+/g, "");
  const decimal = cleaned.match(/[.,](\d{2})$/);
  const integerPart = (decimal ? cleaned.slice(0, cleaned.length - 3) : cleaned).replace(/[.,]/g, "");
  return Number(decimal ? `${integerPart}.${decimal[1]}` : integerPart);
}

function isoDate(text: string): string | undefined {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const long = text.match(/\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/);
  if (long) {
    const mm = MONTHS[long[2]!.toLowerCase()];
    if (mm) return `${long[3]}-${mm}-${long[1]!.padStart(2, "0")}`;
  }
  return undefined;
}

function time24(text: string): string | undefined {
  const t = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return t ? `${t[1]!.padStart(2, "0")}:${t[2]}` : undefined;
}

function amount(text: string): Fields["amount"] {
  const m = text.match(/([€$£])\s?((?:\d{1,3}(?:[.,\s]\d{3})+|\d+)(?:[.,]\d{2})?)/);
  if (!m) return undefined;
  const currency = m[1] === "€" ? "EUR" : m[1] === "£" ? "GBP" : "USD";
  return { value: normalizeAmount(m[2]!), currency };
}

export function extractFields(text: string, cls: DocClass): Fields {
  const fields: Fields = {};
  const date = isoDate(text);
  if (cls === "appointment") {
    if (date) fields.appointmentAt = time24(text) ? `${date}T${time24(text)}:00` : date;
  } else if (date) {
    fields.dueDate = date;
  }
  const amt = amount(text);
  if (amt) fields.amount = amt;
  const iban = text.match(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/i);
  if (iban) fields.maskedAccount = maskAccount(iban[0]);
  const ref = text.match(/\b(?:reference|kundennummer|customer no\.?|ref)\s*[:#]?\s*([A-Z0-9-]{4,})/i);
  if (ref) {
    fields.reference = redactSensitive(ref[1]!);
  }
  return fields;
}
