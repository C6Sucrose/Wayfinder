import { describe, it, expect } from "vitest";
import { pickUiTool, scanIsIncomplete } from "../web/src/uiTools.js";
import { toolNameFromHostContext } from "../ui/src/hostContext.js";

describe("pickUiTool", () => {
  const ui = ["get_scan", "daily_briefing"] as const;
  it("returns the first call that has a UI", () => {
    expect(pickUiTool([{ name: "capture_scan" }, { name: "get_scan" }], ui)).toEqual({ name: "get_scan" });
  });
  it("returns undefined when no call has a UI", () => {
    expect(pickUiTool([{ name: "capture_scan" }], ui)).toBeUndefined();
  });
});

describe("scanIsIncomplete", () => {
  it("is true for queued and analyzing scans", () => {
    expect(scanIsIncomplete({ structuredContent: { status: "queued" } })).toBe(true);
    expect(scanIsIncomplete({ structuredContent: { status: "analyzing" } })).toBe(true);
  });
  it("is false for ready and failed scans", () => {
    expect(scanIsIncomplete({ structuredContent: { status: "ready" } })).toBe(false);
    expect(scanIsIncomplete({ structuredContent: { status: "failed" } })).toBe(false);
  });
  it("is false for missing, undefined, or non-object payloads", () => {
    expect(scanIsIncomplete(undefined)).toBe(false);
    expect(scanIsIncomplete(null)).toBe(false);
    expect(scanIsIncomplete("queued")).toBe(false);
    expect(scanIsIncomplete({})).toBe(false);
    expect(scanIsIncomplete({ structuredContent: null })).toBe(false);
    expect(scanIsIncomplete({ structuredContent: "queued" })).toBe(false);
  });
});

describe("toolNameFromHostContext", () => {
  it("returns the tool name when present", () => {
    expect(toolNameFromHostContext({ toolInfo: { tool: { name: "get_scan" } } })).toBe("get_scan");
  });
  it("returns an empty string when the tool name is missing", () => {
    expect(toolNameFromHostContext({ toolInfo: {} })).toBe("");
    expect(toolNameFromHostContext(undefined)).toBe("");
  });
});
