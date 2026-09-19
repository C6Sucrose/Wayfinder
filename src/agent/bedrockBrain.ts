import type { BedrockConverseLike } from "../scan/bedrockExtractor.js";
import type { McpExecutor } from "./mcpExecutor.js";
import type { AgentResult, Brain } from "./types.js";

const DEFAULT_SYSTEM =
  "You are Wayfinder, a voice-first assistant for blind and low-vision people. " +
  "Use the available tools to complete the user's request rather than describing what you would do. " +
  "Never read out identifiers, URLs, JSON, or internal tool names. " +
  "For labels and medication, read the text verbatim and never give medical advice. " +
  "This is a simulation of a voice assistant; keep replies short and spoken-friendly.";

interface ConverseContent {
  text?: string;
  toolUse?: { toolUseId: string; name: string; input?: Record<string, unknown> };
}
interface ConverseResponse {
  output?: { message?: { role?: string; content?: ConverseContent[] } };
}

export function createBedrockBrain(deps: {
  client: BedrockConverseLike;
  executor: McpExecutor;
  modelId: string;
  maxRounds?: number;
  systemPrompt?: string;
}): Brain {
  const maxRounds = Math.max(1, deps.maxRounds ?? 4);

  return {
    async respond(utterance, history): Promise<AgentResult> {
      const toolSpecs = await deps.executor.listTools();
      const tools = toolSpecs.map((t) => ({
        toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.inputSchema } }
      }));

      const messages: Array<{ role: "user" | "assistant"; content: unknown }> = history.map((h) => ({
        role: h.role,
        content: [{ text: h.text }]
      }));
      messages.push({ role: "user", content: [{ text: utterance }] });

      const toolCalls: AgentResult["toolCalls"] = [];

      for (let round = 0; round < maxRounds; round += 1) {
        const response = (await deps.client.send({
          modelId: deps.modelId,
          system: [{ text: deps.systemPrompt ?? DEFAULT_SYSTEM }],
          messages,
          toolConfig: { tools }
        })) as ConverseResponse;

        const content = response.output?.message?.content ?? [];
        const toolUses = content.filter((c) => c.toolUse);
        const text = content.map((c) => c.text ?? "").join(" ").trim();

        if (toolUses.length === 0) {
          return { reply: text || "I'm not sure how to help with that yet.", toolCalls };
        }

        messages.push({ role: "assistant", content });
        const results: Array<{ toolResult: { toolUseId: string; content: Array<{ json: unknown }>; status: string } }> = [];
        for (const block of toolUses) {
          const use = block.toolUse!;
          const input = use.input ?? {};
          toolCalls.push({ name: use.name, input });
          const outcome = await deps.executor.callTool(use.name, input);
          results.push({
            toolResult: {
              toolUseId: use.toolUseId,
              content: [{ json: { text: outcome.text, isError: outcome.isError } }],
              status: outcome.isError ? "error" : "success"
            }
          });
        }
        messages.push({ role: "user", content: results });
      }

      return { reply: "I couldn't finish that — please try again.", toolCalls };
    }
  };
}
