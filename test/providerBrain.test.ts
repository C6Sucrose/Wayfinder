import { describe, it, expect } from "vitest";
import { createProviderBrain } from "../src/agent/providerBrain.js";
import type { McpExecutor } from "../src/agent/mcpExecutor.js";
import type { ChatProvider, ChatResult } from "../src/providers/types.js";

type ChatRequest = Parameters<ChatProvider["chat"]>[0];

function providerReturning(responses: ChatResult[], seen: ChatRequest[] = []): ChatProvider {
  let i = 0;
  return {
    id: "fake",
    protocol: "openai-compatible",
    supportsImages: false,
    async chat(request) {
      seen.push(request);
      const response = responses[i] ?? responses[responses.length - 1];
      i += 1;
      return response ?? { text: "done", toolCalls: [] };
    }
  };
}

function executor(text: string): McpExecutor {
  return {
    async listTools() {
      return [{ name: "get_backlog", description: "d", inputSchema: { type: "object" } }];
    },
    async callTool() {
      return { text, isError: false };
    },
    async close() {}
  };
}

describe("createProviderBrain", () => {
  it("runs a tool call and returns the final text", async () => {
    const seen: ChatRequest[] = [];
    const brain = createProviderBrain({
      provider: providerReturning(
        [
          { text: "", toolCalls: [{ id: "t1", name: "get_backlog", input: {} }] },
          { text: "Three things need attention.", toolCalls: [] }
        ],
        seen
      ),
      executor: executor("backlog text")
    });
    const result = await brain.respond("what do I need to deal with?", []);
    expect(result.reply).toBe("Three things need attention.");
    expect(result.toolCalls).toEqual([{ name: "get_backlog", input: {} }]);
    expect(seen[0]?.tools?.[0]?.name).toBe("get_backlog");
    expect(seen[1]?.messages.some((m) => m.role === "tool")).toBe(true);
  });

  it("stops at the round cap", async () => {
    const brain = createProviderBrain({
      provider: providerReturning([{ text: "", toolCalls: [{ id: "t", name: "get_backlog", input: {} }] }]),
      executor: executor("x"),
      maxRounds: 2
    });
    const result = await brain.respond("loop", []);
    expect(result.reply).toContain("couldn't finish");
  });
});
