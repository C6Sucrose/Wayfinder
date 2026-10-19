import { describe, it, expect } from "vitest";
import { createRuleBrain } from "../src/agent/ruleBrain.js";
import type { McpExecutor } from "../src/agent/mcpExecutor.js";

function executor(): { calls: Array<{ name: string; input: Record<string, unknown> }>; exec: McpExecutor } {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  return {
    calls,
    exec: {
      async listTools() { return [{ name: "capture_scan", description: "scan", inputSchema: {} }]; },
      async callTool(name, input) { calls.push({ name, input }); return { text: "done", isError: false }; },
      async close() {}
    }
  };
}

describe("createRuleBrain", () => {
  it("routes mail reading to capture_scan", async () => {
    const { calls, exec } = executor();
    const brain = createRuleBrain({ executor: exec });
    const r = await brain.respond("read my mail", []);
    expect(calls[0]!.name).toBe("capture_scan");
    expect(r.reply).toBe("done");
  });

  it("routes 'where are my keys' to find_object with the name", async () => {
    const { calls, exec } = executor();
    const brain = createRuleBrain({ executor: exec });
    await brain.respond("where are my keys?", []);
    expect(calls[0]).toEqual({ name: "find_object", input: { name: "keys" } });
  });

  it("routes 'prove it' to verify_ledger", async () => {
    const { calls, exec } = executor();
    const brain = createRuleBrain({ executor: exec });
    await brain.respond("prove it", []);
    expect(calls[0]!.name).toBe("verify_ledger");
  });

  it("falls back to daily_briefing for anything else", async () => {
    const { calls, exec } = executor();
    const brain = createRuleBrain({ executor: exec });
    await brain.respond("blah", []);
    expect(calls[0]!.name).toBe("daily_briefing");
  });
});
