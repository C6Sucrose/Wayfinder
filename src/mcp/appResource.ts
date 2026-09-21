import { readFileSync, existsSync } from "node:fs";

export const APP_RESOURCE_URI = "ui://wayfinder/app.html";
export const UI_TOOLS = [
  "get_scan", "list_items", "get_item", "daily_briefing", "identify_product", "find_object",
  "get_backlog", "get_audit"
] as const;

export function readAppHtml(): string {
  const path = "dist/ui/app.html";
  if (!existsSync(path)) {
    throw new Error(`UI bundle missing at ${path}. Run: npm run build:ui`);
  }
  return readFileSync(path, "utf8");
}
