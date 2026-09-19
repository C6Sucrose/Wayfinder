import { describe, it, expect } from "vitest";
import { createMcpExecutor } from "../src/agent/mcpExecutor.js";

describe("createMcpExecutor", () => {
  it("converts MCP tool descriptors into Bedrock-compatible specs", async () => {
    const client = {
      async listTools() {
        return { tools: [{ name: "daily_briefing", description: "brief", inputSchema: { type: "object", properties: {}, $schema: "x" } }] };
      },
      async callTool() { return { content: [{ type: "text", text: "ok" }] }; },
      async close() {}
    };
    const exec = createMcpExecutor({ client });
    const specs = await exec.listTools();
    expect(specs).toHaveLength(1);
    expect(specs[0]!.name).toBe("daily_briefing");
    expect((specs[0]!.inputSchema as Record<string, unknown>).$schema).toBeUndefined();
  });

  it("flattens text content and reports errors", async () => {
    const client = {
      async listTools() { return { tools: [] }; },
      async callTool() { return { isError: true, content: [{ type: "text", text: "nope" }] }; },
      async close() {}
    };
    const exec = createMcpExecutor({ client });
    expect(await exec.callTool("x", {})).toEqual({ text: "nope", isError: true });
  });
});
