export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

export interface ConfidenceRing {
  size: number;
  radius: number;
  circumference: number;
  offset: number;
  percent: number;
  low: boolean;
}

export function confidenceRing(confidence: number, size = 44, stroke = 3): ConfidenceRing {
  const radius = (size - stroke * 2) / 2;
  const circumference = round2(2 * Math.PI * radius);
  const fraction = clamp01(confidence);
  const offset = round2(circumference * (1 - fraction));
  return {
    size,
    radius,
    circumference,
    offset,
    percent: Math.round(fraction * 100),
    low: !(confidence >= 0.7)
  };
}

export interface UrgencyMeter {
  level: number;
  label: string;
  kind: "alert" | "warn" | "quiet";
}

export function urgencyMeter(urgency: string): UrgencyMeter {
  if (urgency === "high") return { level: 1, label: "High urgency", kind: "alert" };
  if (urgency === "medium") return { level: 0.6, label: "Medium urgency", kind: "warn" };
  return { level: 0.25, label: "Low urgency", kind: "quiet" };
}

export interface ChainBlock {
  index: number;
  connected: boolean;
  ellipsis: boolean;
}

export function ledgerChain(count: number, cap = 12): ChainBlock[] {
  if (!Number.isFinite(count) || count <= 0) return [];
  const shown = Math.min(Math.floor(count), cap);
  const blocks: ChainBlock[] = [];
  for (let i = 0; i < shown; i += 1) {
    blocks.push({ index: i, connected: true, ellipsis: false });
  }
  if (count > cap) blocks.push({ index: shown, connected: false, ellipsis: true });
  return blocks;
}
