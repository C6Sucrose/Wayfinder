export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpClientLike {
  listTools(): Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> }>;
  callTool(request: { name: string; arguments: Record<string, unknown> }): Promise<{ isError?: boolean; content?: unknown }>;
  close(): Promise<void>;
}

export interface McpExecutor {
  listTools(): Promise<ToolSpec[]>;
  callTool(name: string, input: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  close(): Promise<void>;
}

function contentToText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block === "object" && block !== null && "text" in block) {
        const text = (block as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function createMcpExecutor(deps: { client: McpClientLike }): McpExecutor {
  return {
    async listTools() {
      const { tools } = await deps.client.listTools();
      return tools.map((tool) => {
        const schema = { ...(tool.inputSchema ?? { type: "object", properties: {} }) };
        delete schema["$schema"];
        return { name: tool.name, description: tool.description ?? tool.name, inputSchema: schema };
      });
    },
    async callTool(name, input) {
      const result = await deps.client.callTool({ name, arguments: input });
      return { text: contentToText(result.content), isError: result.isError === true };
    },
    async close() { await deps.client.close(); }
  };
}
