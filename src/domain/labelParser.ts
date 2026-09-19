import { copy } from "./copy.js";

export type ParsedLabel = {
  name: string;
  details: string[];
  labelText: string;
  disclaimer: string;
};

const DETAIL = /(ingredients|allergen|best before|use by|expiry|expires|contains|may contain|energy|nutrition)/i;

export function parseLabel(text: string): ParsedLabel {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const name = lines[0] ?? "";
  const details = lines.filter((l) => DETAIL.test(l));
  return { name, details, labelText: text, disclaimer: copy.disclaimers.label };
}
