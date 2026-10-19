import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../../src/storage/fileStore.js";
import { createHttpApp } from "../../src/server/http.js";

const app = (alexa: Parameters<typeof createHttpApp>[0]["alexa"]) =>
  createHttpApp({ store: createFileStore(mkdtempSync(join(tmpdir(), "wf-"))), ...(alexa ? { alexa } : {}) });

async function post(app: ReturnType<typeof createHttpApp>, body: string, headers: Record<string, string> = {}) {
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/alexa`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body
    });
    return { status: response.status, body: await response.text() };
  } finally {
    server.close();
  }
}

const validBody = JSON.stringify({
  version: "1.0",
  session: { sessionId: "s1" },
  request: { type: "IntentRequest", timestamp: new Date().toISOString(), intent: { name: "BacklogIntent" } }
});

describe("POST /alexa", () => {
  it("returns 401 when the verifier rejects", async () => {
    const result = await post(app({
      verify: async () => ({ ok: false, reason: "bad" }),
      agent: { brainName: "rules", async handle() { return { reply: "x", toolCalls: [], brain: "rules" }; } },
      sessions: { history: () => [], append: () => undefined, size: () => 0, clear: () => undefined },
      verifyEnabled: true
    }), validBody);
    expect(result.status).toBe(401);
  });

  it("returns 200 with an SSML response when the verifier accepts", async () => {
    const result = await post(app({
      verify: async () => ({ ok: true }),
      agent: { brainName: "rules", async handle() { return { reply: "hello", toolCalls: [], brain: "rules" }; } },
      sessions: { history: () => [], append: () => undefined, size: () => 0, clear: () => undefined },
      verifyEnabled: true
    }), validBody);
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body).response.outputSpeech.type).toBe("SSML");
  });

  it("returns 404 when the skill is not mounted", async () => {
    const result = await post(app(undefined), validBody);
    expect(result.status).toBe(404);
  });

  it("returns 400 when the body is JSON null", async () => {
    const result = await post(app({
      verify: async () => ({ ok: true }),
      agent: { brainName: "rules", async handle() { return { reply: "x", toolCalls: [], brain: "rules" }; } },
      sessions: { history: () => [], append: () => undefined, size: () => 0, clear: () => undefined },
      verifyEnabled: true
    }), "null");
    expect(result.status).toBe(400);
  });

  it("returns 401 when the verifier throws", async () => {
    const result = await post(app({
      verify: async () => { throw new Error("boom"); },
      agent: { brainName: "rules", async handle() { return { reply: "x", toolCalls: [], brain: "rules" }; } },
      sessions: { history: () => [], append: () => undefined, size: () => 0, clear: () => undefined },
      verifyEnabled: true
    }), validBody);
    expect(result.status).toBe(401);
  });

  it("passes the posted bytes to the verifier unchanged", async () => {
    let seen: Uint8Array | undefined;
    const result = await post(app({
      verify: async (input) => { seen = input.rawBody; return { ok: true }; },
      agent: { brainName: "rules", async handle() { return { reply: "hello", toolCalls: [], brain: "rules" }; } },
      sessions: { history: () => [], append: () => undefined, size: () => 0, clear: () => undefined },
      verifyEnabled: true
    }), validBody);
    expect(result.status).toBe(200);
    expect(Buffer.from(seen ?? new Uint8Array()).equals(Buffer.from(validBody))).toBe(true);
  });
});
