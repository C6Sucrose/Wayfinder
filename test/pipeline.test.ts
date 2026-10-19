import { describe, it, expect } from "vitest";
import { STAGES, stageFor, stagesFor, pipelineState } from "../web/src/pipeline.js";

describe("stageFor", () => {
  it("maps tools to their pipeline stage", () => {
    expect(stageFor("capture_scan")).toBe("capture");
    expect(stageFor("get_scan")).toBe("capture");
    expect(stageFor("get_backlog")).toBe("correlate");
    expect(stageFor("daily_briefing")).toBe("correlate");
    expect(stageFor("act_on_item")).toBe("authority");
    expect(stageFor("prepare_payment")).toBe("authority");
    expect(stageFor("verify_ledger")).toBe("record");
  });

  it("returns undefined for unknown tools", () => {
    expect(stageFor("nope")).toBeUndefined();
  });
});

describe("stagesFor", () => {
  it("returns the distinct stages the calls touch, in order", () => {
    expect(
      stagesFor([{ name: "capture_scan" }, { name: "get_scan" }, { name: "get_backlog" }])
    ).toEqual(["capture", "correlate"]);
  });

  it("is empty when nothing maps", () => {
    expect(stagesFor([{ name: "nope" }])).toEqual([]);
  });
});

describe("pipelineState", () => {
  it("marks earlier stages done, the active stage current, and the rest pending", () => {
    expect(pipelineState("authority").map((s) => s.status)).toEqual(["done", "done", "current", "pending"]);
  });

  it("leaves everything pending when idle", () => {
    expect(pipelineState(undefined).every((s) => s.status === "pending")).toBe(true);
  });
});

describe("STAGES", () => {
  it("is the four stages in narrative order", () => {
    expect(STAGES.map((s) => s.id)).toEqual(["capture", "correlate", "authority", "record"]);
  });
});
