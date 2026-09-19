import { describe, it, expect } from "vitest";
import { planActions } from "../src/domain/actionPlanner.js";
import type { Item } from "../src/domain/model.js";

const base: Item = {
  itemId: "itm_1", scanId: "scn_1", class: "bill", confidence: 0.8,
  readAloudText: "A bill.", fields: { dueDate: "2026-10-01" },
  proposedActions: [], createdAt: "2026-09-19T10:00:00.000Z", resolvedAt: null
};

describe("planActions", () => {
  it("plans a reminder for a bill with a due date", () => {
    const actions = planActions(base);
    expect(actions.map((a) => a.type)).toContain("remind");
  });

  it("plans a schedule action for an appointment", () => {
    const actions = planActions({ ...base, class: "appointment", fields: { appointmentAt: "2026-11-12T09:30:00" } });
    expect(actions.map((a) => a.type)).toContain("schedule");
  });

  it("plans a flag action for high-risk scam", () => {
    const actions = planActions({ ...base, class: "scam", fields: {} }, { riskScore: 0.8, band: "high", reasons: [] });
    expect(actions.map((a) => a.type)).toContain("flag");
  });

  it("is idempotent (same input yields same action ids)", () => {
    expect(JSON.stringify(planActions(base))).toBe(JSON.stringify(planActions(base)));
  });
});
