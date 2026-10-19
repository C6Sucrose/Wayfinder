import { describe, it, expect } from "vitest";
import { createAlexaHandler } from "../../src/alexa/handler.js";
import { createAgentService } from "../../src/agent/service.js";

const body = (intent: string, sessionId = "s1", timestamp = new Date().toISOString(), applicationId?: string) =>
  Buffer.from(JSON.stringify({
    version: "1.0",
    session: { sessionId, ...(applicationId !== undefined ? { application: { applicationId } } : {}) },
    request: { type: "IntentRequest", timestamp, intent: { name: intent } },
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
    const result = await createAlexaHandler(d)(Buffer.from(JSON.stringify({ version: "1.0", session: { sessionId: "s" }, request: { type: "LaunchRequest", timestamp: new Date().toISOString() } })));
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

  it.each([null, [], "x", 42, {}])("rejects the non-envelope body %j", async (value) => {
    let verified = 0;
    const { calls, deps: d } = deps({
      verify: async () => { verified += 1; return { ok: true as const }; }
    });
    const result = await createAlexaHandler(d)(Buffer.from(JSON.stringify(value)));
    expect(result.status).toBe(400);
    expect(calls).toEqual([]);
    expect(verified).toBe(0);
  });

  it("treats a thrown verifier as unauthorized", async () => {
    const { calls, deps: d } = deps({
      verify: async () => { throw new Error("boom"); }
    });
    const result = await createAlexaHandler(d)(body("BacklogIntent"));
    expect(result.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("rejects a stale timestamp even when verification is disabled", async () => {
    let verified = 0;
    const { calls, deps: d } = deps({
      verifyEnabled: false,
      verify: async () => { verified += 1; return { ok: true as const }; }
    });
    const timestamp = new Date(Date.now() - 10 * 60_000).toISOString();
    const result = await createAlexaHandler(d)(body("BacklogIntent", "s1", timestamp));
    expect(result.status).toBe(401);
    expect(calls).toEqual([]);
    expect(verified).toBe(0);
  });

  it("accepts a fresh timestamp when verification is disabled", async () => {
    const { calls, deps: d } = deps({ verifyEnabled: false });
    const result = await createAlexaHandler(d)(body("BacklogIntent"));
    expect(result.status).toBe(200);
    expect(calls).toEqual(["what do I need to deal with?"]);
  });

  it("rejects a non-string timestamp", async () => {
    const { calls, deps: d } = deps();
    const payload = JSON.parse(body("BacklogIntent").toString());
    payload.request.timestamp = 12345;
    const result = await createAlexaHandler(d)(Buffer.from(JSON.stringify(payload)));
    expect(result.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("accepts a matching application id", async () => {
    const { deps: d } = deps({ appId: "amzn1.ask.skill.ok" });
    const result = await createAlexaHandler(d)(body("BacklogIntent", "s1", new Date().toISOString(), "amzn1.ask.skill.ok"));
    expect(result.status).toBe(200);
  });

  it("rejects a mismatched application id", async () => {
    const { calls, deps: d } = deps({ appId: "amzn1.ask.skill.ok" });
    const result = await createAlexaHandler(d)(body("BacklogIntent", "s1", new Date().toISOString(), "amzn1.ask.skill.other"));
    expect(result.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("accepts any application id when none is configured", async () => {
    const { deps: d } = deps();
    const result = await createAlexaHandler(d)(body("BacklogIntent", "s1", new Date().toISOString(), "amzn1.ask.skill.other"));
    expect(result.status).toBe(200);
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

  it("routes ProveIntent through the rules brain to verify_ledger", async () => {
    const toolCalls: string[] = [];
    const agent = createAgentService({
      executor: {
        async listTools() { return []; },
        async callTool(name) {
          toolCalls.push(name);
          return { text: "The chain is intact; the record verifies.", isError: false };
        },
        async close() {}
      }
    });
    const { deps: d } = deps({ agent });
    const result = await createAlexaHandler(d)(body("ProveIntent"));
    expect(toolCalls).toEqual(["verify_ledger"]);
    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body)).toMatch(/chain|record/i);
  });
});
