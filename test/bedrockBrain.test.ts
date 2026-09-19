import { describe, it, expect } from "vitest";
import { createBedrockBrain } from "../src/agent/bedrockBrain.js";
import type { McpExecutor } from "../src/agent/mcpExecutor.js";

const executor: McpExecutor = {
  async listTools() {
    return [{ name: "daily_briefing", description: "brief", inputSchema: { type: "object", properties: {} } }];
  },
  async callTool() { return { text: "You have 1 due, 0 flagged.", isError: false }; },
  async close() {}
};

describe("createBedrockBrain", () => {
  it("executes a tool use round and returns the final text", async () => {
    const sent: unknown[] = [];
    let call = 0;
    const client = {
      async send(command: unknown) {
        sent.push(command);
        call += 1;
        if (call === 1) {
          return { output: { message: { role: "assistant", content: [{ toolUse: { toolUseId: "t1", name: "daily_briefing", input: {} } }] } } };
        }
        return { output: { message: { role: "assistant", content: [{ text: "You have 1 due item." }] } } };
      }
    };
    const brain = createBedrockBrain({ client, executor, modelId: "test-model" });
    const result = await brain.respond("what's due?", []);
    expect(result.reply).toBe("You have 1 due item.");
    expect(result.toolCalls).toEqual([{ name: "daily_briefing", input: {} }]);
    expect(sent).toHaveLength(2);
  });

  it("returns a safe message when the model never produces text", async () => {
    const client = { async send() { return { output: { message: { role: "assistant", content: [] } } }; } };
    const brain = createBedrockBrain({ client, executor, modelId: "test-model", maxRounds: 2 });
    const result = await brain.respond("hello", []);
    expect(result.reply.length).toBeGreaterThan(0);
    expect(result.toolCalls).toEqual([]);
  });
});
