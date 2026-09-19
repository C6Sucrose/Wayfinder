export function pickUiTool(
  calls: Array<{ name: string }>,
  uiTools: readonly string[]
): { name: string } | undefined {
  return calls.find((c) => uiTools.includes(c.name));
}
