export type CueName = "listen-start" | "listen-stop" | "recorded";

const CUES: Record<CueName, { hz: number; ms: number }> = {
  "listen-start": { hz: 660, ms: 90 },
  "listen-stop": { hz: 440, ms: 90 },
  recorded: { hz: 880, ms: 140 }
};

export function cueFor(name: CueName): { hz: number; ms: number } {
  return CUES[name];
}

export function normalizeLevel(byte: number): number {
  if (!Number.isFinite(byte)) return 0;
  return Math.min(1, Math.max(0, byte / 255));
}

export function smoothLevel(previous: number, next: number): number {
  const rate = next > previous ? 0.5 : 0.15;
  return previous + (next - previous) * rate;
}

export function historyPoints(
  levels: number[],
  height: number,
  width = 100
): Array<{ x: number; y: number }> {
  if (!levels.length) return [];
  const lastIndex = levels.length - 1;
  return levels.map((level, index) => ({
    x: lastIndex === 0 ? width / 2 : Math.round((index / lastIndex) * width * 100) / 100,
    y: Math.round((1 - Math.min(1, Math.max(0, level))) * height * 100) / 100
  }));
}
