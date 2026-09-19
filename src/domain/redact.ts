const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/gi;
const LONG_DIGITS = /\b\d{7,}\b/g;
// Separators seen in printed numbers: spaces, tabs, non-breaking spaces, or dashes.
const SEP = "[ \\t\\u00a0-]+";
// Printed IBANs: "DE89 3704 0044 0532 0130 00" — country code + groups, which
// may contain letters (e.g. "GB29 NWBK 6016 1331 9268 19").
const GROUPED_IBAN = new RegExp(`\\b[A-Z]{2}\\d{2}(?:${SEP}[A-Z0-9]{4}){2,7}(?:${SEP}[A-Z0-9]{1,4})?\\b`, "gi");
// Grouped card/account numbers: two or more 4-digit groups with any of those separators.
const GROUPED_DIGITS = new RegExp(`\\b\\d{4}(?:${SEP}\\d{4}){1,}\\b`, "g");

export function maskAccount(raw: string): string {
  const clean = raw.replace(/\D/g, "");
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
