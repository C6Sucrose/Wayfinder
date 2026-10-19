import { describe, it, expect } from "vitest";
import { createAlexaHandler } from "../../src/alexa/handler.js";

const body = (intent: string, sessionId = "s1") =>
  Buffer.from(JSON.stringify({
    version: "1.0",
    session: { sessionId },
    request: { type: "IntentRequest", timestamp: "2026-10-17T10:00:00Z", intent: { name: intent } },
    context: { System: { device: { supportedInterfaces: {} } } }
  }));

function deps(overrides: Partial<Parameters<typeof createAlexaHandler>[0]> = {}) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      verify: async () => ({ ok: true as const }),
      agent: {
        brainName: "rules",
        async handle(utterance: string) {
          calls.push(utterance);
          return { reply: `reply to ${utterance}`, toolCalls: [], brain: "rules" };
        }
      },
      sessions: { history: () => [], append: () => undefined, size: () => 0, clear: () => undefined },
      verifyEnabled: true,
      ...overrides
    }
  };
}

describe("alexa handler", () => {
  it("routes an intent through the agent and replies", async () => {
    const { calls, deps: d } = deps();
    const result = await createAlexaHandler(d)(body("BacklogIntent"));
    expect(calls).toEqual(["what do I need to deal with?"]);
    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body)).toContain("reply to what do I need to deal with?");
  });

  it("answers a launch request without calling the agent", async () => {
    const { calls, deps: d } = deps();
    const result = await createAlexaHandler(d)(Buffer.from(JSON.stringify({ version: "1.0", session: { sessionId: "s" }, request: { type: "LaunchRequest", timestamp: "2026-10-17T10:00:00Z" } })));
    expect(calls).toEqual([]);
    expect(result.status).toBe(200);
  });

  it("rejects when verification fails", async () => {
    const { calls, deps: d } = deps({ verify: async () => ({ ok: false as const, reason: "bad signature" }) });
    const result = await createAlexaHandler(d)(body("BacklogIntent"));
    expect(result.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("returns 400 for malformed JSON", async () => {
    const { deps: d } = deps();
    const result = await createAlexaHandler(d)(Buffer.from("{not json"));
    expect(result.status).toBe(400);
  });

  it("speaks an apology when the agent fails", async () => {
    const { deps: d } = deps({
      agent: { brainName: "rules", async handle() { throw new Error("boom"); } }
    });
    const result = await createAlexaHandler(d)(body("BacklogIntent"));
    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body)).toContain("couldn't");
  });

  it("reads and appends session history", async () => {
    let stored: Array<{ role: "user" | "assistant"; text: string }> = [];
    let received = -1;
    const { deps: d } = deps({
      sessions: {
        history: () => { received = stored.length; return stored; },
        append: (_id, entries) => { stored = [...stored, ...entries]; },
        size: () => 0,
        clear: () => undefined
      }
    });
    await createAlexaHandler(d)(body("BacklogIntent"));
    expect(received).toBe(0);
    expect(stored.length).toBe(2);
  });

  it("adds the APL directive when the device supports it", async () => {
    const { deps: d } = deps();
    const payload = JSON.parse(body("BacklogIntent").toString());
    payload.context.System.device.supportedInterfaces["Alexa.Presentation.APL"] = {};
    const result = await createAlexaHandler(d)(Buffer.from(JSON.stringify(payload)));
    expect(JSON.stringify(result.body)).toContain("Alexa.Presentation.APL.RenderDocument");
  });
});
