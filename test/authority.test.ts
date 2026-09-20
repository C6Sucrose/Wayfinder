import { describe, it, expect } from "vitest";
import { kindFor, evaluateAuthority } from "../src/domain/authority.js";
import type { Authority, DocumentRecord } from "../src/domain/model.js";

const authority: Authority = {
  autoActUpTo: { currency: "EUR", value: 100 },
  confirmAbove: { currency: "EUR", value: 50 },
  forbidden: ["share_personal_data", "delete_document"],
  onLowConfidence: "ask"
};

const record = (confidence: "high" | "low" = "high"): DocumentRecord => ({
  itemId: "itm_1", scanId: "scn_1", class: "bill", confidence: 0.9, readAloudText: "bill",
  fields: {}, proposedActions: [], createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null,
  record: { lifecycle: "awaiting_action", confidence, needsRecapture: false, demands: [], threadKey: "t_1" }
});

describe("kindFor", () => {
  it("maps action types to policy kinds", () => {
    expect(kindFor("remind")).toBe("other");
    expect(kindFor("share")).toBe("share_personal_data");
    expect(kindFor("discard")).toBe("discard_document");
  });
});

describe("evaluateAuthority", () => {
  it("allows a small amount under both thresholds", () => {
    expect(evaluateAuthority({ actionType: "remind", amount: { currency: "EUR", value: 20 }, record: record(), authority }).decision).toBe("allow");
  });
  it("confirms an amount above the confirmation floor", () => {
    expect(evaluateAuthority({ actionType: "remind", amount: { currency: "EUR", value: 60 }, record: record(), authority }).decision).toBe("confirm");
  });
  it("confirms an amount above the auto-action ceiling", () => {
    expect(evaluateAuthority({ actionType: "remind", amount: { currency: "EUR", value: 500 }, record: record(), authority }).decision).toBe("confirm");
  });
  it("refuses a forbidden action regardless of amount", () => {
    const result = evaluateAuthority({ actionType: "share", amount: { currency: "EUR", value: 1 }, record: record(), authority });
    expect(result.decision).toBe("refuse");
    expect(result.reason.length).toBeGreaterThan(0);
  });
  it("confirms a low-confidence action when the policy is ask", () => {
    expect(evaluateAuthority({ actionType: "file", record: record("low"), authority }).decision).toBe("confirm");
  });
  it("refuses a low-confidence action when the policy is refuse", () => {
    expect(evaluateAuthority({ actionType: "file", record: record("low"), authority: { ...authority, onLowConfidence: "refuse" } }).decision).toBe("refuse");
  });
  it("refuses with an escalation reason when the policy is escalate", () => {
    const result = evaluateAuthority({ actionType: "file", record: record("low"), authority: { ...authority, onLowConfidence: "escalate" } });
    expect(result.decision).toBe("refuse");
    expect(result.reason.toLowerCase()).toContain("trusted contact");
  });
  it("allows a high-confidence non-forbidden action with no amount", () => {
    expect(evaluateAuthority({ actionType: "file", record: record(), authority }).decision).toBe("allow");
  });
});
