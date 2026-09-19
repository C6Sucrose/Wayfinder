import { describe, it, expect } from "vitest";
import { pickUiTool } from "../web/src/uiTools.js";
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

describe("toolNameFromHostContext", () => {
  it("returns the tool name when present", () => {
    expect(toolNameFromHostContext({ toolInfo: { tool: { name: "get_scan" } } })).toBe("get_scan");
  });
  it("returns an empty string when the tool name is missing", () => {
    expect(toolNameFromHostContext({ toolInfo: {} })).toBe("");
    expect(toolNameFromHostContext(undefined)).toBe("");
  });
});
