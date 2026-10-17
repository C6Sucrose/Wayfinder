export function pickUiTool<T extends { name: string }>(
  calls: T[],
  uiTools: readonly string[]
): T | undefined {
  return calls.find((c) => uiTools.includes(c.name));
}

export function scanIsIncomplete(result: unknown): boolean {
  if (typeof result !== "object" || result === null) return false;
  const structured = (result as { structuredContent?: unknown }).structuredContent;
  if (typeof structured !== "object" || structured === null) return false;
  const status = (structured as { status?: unknown }).status;
  return status === "queued" || status === "analyzing";
}
