const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/gi;
const LONG_DIGITS = /\b\d{7,}\b/g;
// Printed IBANs: "DE89 3704 0044 0532 0130 00" — country code + digit groups.
const GROUPED_IBAN = /\b[A-Z]{2}\d{2}(?:[ -]?\d{4}){2,7}(?:[ -]?\d{1,4})?\b/gi;
// Grouped card/account numbers: two or more 4-digit groups, space or dash separated.
const GROUPED_DIGITS = /\b\d{4}(?:[ -]\d{4}){1,}\b/g;

export function maskAccount(raw: string): string {
  const clean = raw.replace(/\s+/g, "");
  if (clean.length < 5) {
    return clean.length > 2 ? `••••${clean.slice(-2)}` : "••••";
  }
  return `••••${clean.slice(-4)}`;
}

export function redactSensitive(text: string): string {
  return text
    .replace(IBAN, (m) => maskAccount(m))
    .replace(GROUPED_IBAN, (m) => maskAccount(m))
    .replace(LONG_DIGITS, (m) => maskAccount(m))
    .replace(GROUPED_DIGITS, (m) => maskAccount(m));
}
