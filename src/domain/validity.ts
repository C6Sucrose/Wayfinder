const IBAN_SHAPE = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;

export function ibanIsValid(raw: string): boolean {
  const clean = raw.replace(/\s+/g, "").toUpperCase();
  if (!IBAN_SHAPE.test(clean)) return false;
  const rearranged = clean.slice(4) + clean.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of numeric) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

export function datePlausible(
  iso: string,
  now: Date,
  options?: { pastDays?: number; futureDays?: number }
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return false;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return false;
  const pastDays = options?.pastDays ?? 30;
  const futureDays = options?.futureDays ?? 730;
  const deltaDays = (parsed.getTime() - now.getTime()) / 86_400_000;
  return deltaDays >= -pastDays && deltaDays <= futureDays;
}

export function amountSane(
  amount: { value: number; currency: string },
  history?: number[]
): boolean {
  if (!Number.isFinite(amount.value) || amount.value < 0) return false;
  if (!history || history.length < 3) return true;
  const sorted = [...history].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  if (median <= 0) return true;
  return amount.value <= median * 20;
}
