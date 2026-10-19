import { describe, it, expect } from "vitest";
import { routeIntent } from "../../src/alexa/intents.js";

const intent = (name: string, slots: Record<string, string> = {}) => ({
  request: {
    type: "IntentRequest",
    intent: { name, slots: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, { value: v }])) }
  }
});

describe("routeIntent", () => {
  it("greets on launch", () => {
    const r = routeIntent({ request: { type: "LaunchRequest" } });
    expect(r.kind).toBe("direct");
    if (r.kind === "direct") {
      expect(r.end).toBe(false);
      expect(r.speech).toContain("Wayfinder");
    }
  });

  it("maps read mail", () => {
    expect(routeIntent(intent("ReadMailIntent"))).toEqual({ kind: "speak", utterance: "read my mail" });
  });

  it("maps backlog", () => {
    expect(routeIntent(intent("BacklogIntent"))).toEqual({ kind: "speak", utterance: "what do I need to deal with?" });
  });

  it("maps due today", () => {
    expect(routeIntent(intent("DueTodayIntent"))).toEqual({ kind: "speak", utterance: "what's due today?" });
  });

  it("maps prove it", () => {
    expect(routeIntent(intent("ProveIntent"))).toEqual({ kind: "speak", utterance: "prove it" });
  });

  it("interpolates the item slot", () => {
    expect(routeIntent(intent("WhereIsIntent", { item: "keys" }))).toEqual({ kind: "speak", utterance: "where are my keys" });
  });

  it("trims and caps slot values", () => {
    const long = "x".repeat(200);
    const r = routeIntent(intent("WhereIsIntent", { item: `  ${long}  ` }));
    if (r.kind === "speak") expect(r.utterance.length).toBeLessThan(120);
  });

  it("rephrases when the item slot is missing", () => {
    const r = routeIntent(intent("WhereIsIntent"));
    expect(r.kind).toBe("direct");
    if (r.kind === "direct") expect(r.end).toBe(false);
  });

  it("interpolates remember slots", () => {
    expect(routeIntent(intent("RememberIntent", { item: "keys", location: "the kitchen counter" }))).toEqual({
      kind: "speak",
      utterance: "remember my keys is at the kitchen counter"
    });
  });

  it("rephrases when a remember slot is missing", () => {
    expect(routeIntent(intent("RememberIntent", { item: "keys" })).kind).toBe("direct");
  });

  it("answers help without calling the brain", () => {
    const r = routeIntent(intent("AMAZON.HelpIntent"));
    expect(r.kind).toBe("direct");
    if (r.kind === "direct") expect(r.end).toBe(false);
  });

  it("ends on stop and cancel", () => {
    for (const name of ["AMAZON.StopIntent", "AMAZON.CancelIntent"]) {
      const r = routeIntent(intent(name));
      expect(r.kind).toBe("direct");
      if (r.kind === "direct") expect(r.end).toBe(true);
    }
  });

  it("rephrases on fallback and unknown intents", () => {
    for (const name of ["AMAZON.FallbackIntent", "NopeIntent"]) {
      const r = routeIntent(intent(name));
      expect(r.kind).toBe("direct");
      if (r.kind === "direct") expect(r.end).toBe(false);
    }
  });
});
