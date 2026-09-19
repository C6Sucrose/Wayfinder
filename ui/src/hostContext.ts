export function toolNameFromHostContext(context: unknown): string {
  if (typeof context !== "object" || context === null) return "";
  const toolInfo = (context as { toolInfo?: unknown }).toolInfo;
  if (typeof toolInfo !== "object" || toolInfo === null) return "";
  const tool = (toolInfo as { tool?: unknown }).tool;
  if (typeof tool !== "object" || tool === null) return "";
  const name = (tool as { name?: unknown }).name;
  return typeof name === "string" ? name : "";
}
