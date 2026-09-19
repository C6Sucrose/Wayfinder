import { describe, it, expect } from "vitest";
import { createAgentService } from "../src/agent/service.js";
import type { McpExecutor } from "../src/agent/mcpExecutor.js";

const exec: McpExecutor = {
  async listTools() { return [{ name: "daily_briefing", description: "b", inputSchema: {} }]; },
  async callTool() { return { text: "Nothing needs your attention today.", isError: false }; },
  async close() {}
};

describe("createAgentService", () => {
  it("uses the rule brain when no Bedrock client is configured", async () => {
    const service = createAgentService({ executor: exec });
    const result = await service.handle("what's due today?");
    expect(result.brain).toBe("rules");
    expect(result.reply).toContain("Nothing");
  });

  it("reports the active brain name", () => {
    expect(createAgentService({ executor: exec }).brainName).toBe("rules");
  });
});
