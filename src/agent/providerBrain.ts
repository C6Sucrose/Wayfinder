import type { McpExecutor } from "./mcpExecutor.js";
import type { AgentResult, Brain, HistoryEntry } from "./types.js";
import type { ChatMessage, ChatProvider } from "../providers/types.js";

const DEFAULT_SYSTEM =
  "You are Wayfinder, a voice-first assistant for blind and low-vision people. " +
  "Use the available tools to complete the user's request rather than describing what you would do. " +
  "Never read out identifiers, URLs, JSON, or internal tool names. " +
  "For labels and medication, read the text verbatim and never give medical advice. " +
  "Keep replies short and spoken-friendly.";

export function createProviderBrain(deps: {
  provider: ChatProvider;
  executor: McpExecutor;
  systemPrompt?: string;
  maxRounds?: number;
}): Brain {
  const maxRounds = Math.max(1, deps.maxRounds ?? 4);

  return {
    async respond(utterance: string, history: HistoryEntry[]): Promise<AgentResult> {
      const tools = (await deps.executor.listTools()).map((tool) => ({
        name: tool.name,
        ...(tool.description !== undefined ? { description: tool.description } : {}),
        inputSchema: tool.inputSchema as Record<string, unknown>
      }));

      const messages: ChatMessage[] = [{ role: "system", text: deps.systemPrompt ?? DEFAULT_SYSTEM }];
      for (const entry of history) messages.push({ role: entry.role, text: entry.text });
      messages.push({ role: "user", text: utterance });

      const toolCalls: AgentResult["toolCalls"] = [];

      for (let round = 0; round < maxRounds; round += 1) {
        const result = await deps.provider.chat({ messages, tools });
        if (result.toolCalls.length === 0) {
          return { reply: result.text || "I'm not sure how to help with that yet.", toolCalls };
        }
        messages.push({ role: "assistant", toolCalls: result.toolCalls });
        const outcomes: Array<{ id: string; text: string; isError: boolean }> = [];
        for (const call of result.toolCalls) {
          toolCalls.push({ name: call.name, input: call.input });
          const outcome = await deps.executor.callTool(call.name, call.input);
          outcomes.push({ id: call.id, text: outcome.text, isError: outcome.isError });
        }
        messages.push({ role: "tool", results: outcomes });
      }

      return { reply: "I couldn't finish that — please try again.", toolCalls };
    }
  };
}
