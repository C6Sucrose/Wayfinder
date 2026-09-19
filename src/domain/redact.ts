const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/gi;
const LONG_DIGITS = /\b\d{7,}\b/g;

export function maskAccount(raw: string): string {
  const clean = raw.replace(/\s+/g, "");
  if (clean.length < 5) {
    return clean.length > 2 ? `••••${clean.slice(-2)}` : "••••";
  }
  return `••••${clean.slice(-4)}`;
}

export function redactSensitive(text: string): string {
  return text
    .replace(IBAN, (match) => maskAccount(match))
    .replace(LONG_DIGITS, (match) => maskAccount(match));
}
