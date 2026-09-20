import type { Fields } from "./model.js";

export const CRITICAL_FIELDS = ["sender", "dueDate", "reference", "maskedAccount"] as const;

type Reading = Partial<Fields> & { amount?: { value: number; currency: string } };

function normalize(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.toLowerCase().replace(/\s+/g, " ") : undefined;
  }
  return String(value);
}

export function compareReadings(a: Reading, b: Reading): { confidence: "high" | "low"; disagreements: string[] } {
  const disagreements: string[] = [];

  const pairs: Array<[string, unknown, unknown]> = [
    ...CRITICAL_FIELDS.map((field) => [field, a[field], b[field]] as [string, unknown, unknown]),
    ["amount.value", a.amount?.value, b.amount?.value]
  ];

  for (const [name, left, right] of pairs) {
    const l = normalize(left);
    const r = normalize(right);
    if (l === undefined && r === undefined) continue;
    if (l !== r) disagreements.push(name);
  }

  return { confidence: disagreements.length === 0 ? "high" : "low", disagreements };
}
