import type { BedrockConverseLike } from "../scan/bedrockExtractor.js";
import type { McpExecutor } from "./mcpExecutor.js";
import { createBedrockBrain } from "./bedrockBrain.js";
import { createRuleBrain } from "./ruleBrain.js";
import type { AgentResult, Brain, HistoryEntry } from "./types.js";

export interface AgentService {
  brainName: "bedrock" | "rules";
  handle(utterance: string, history?: HistoryEntry[]): Promise<AgentResult & { brain: "bedrock" | "rules" }>;
}

export function createAgentService(deps: {
  executor: McpExecutor;
  client?: BedrockConverseLike;
  modelId?: string;
}): AgentService {
  const useBedrock = Boolean(deps.client && deps.modelId);
  const brain: Brain = useBedrock
    ? createBedrockBrain({ client: deps.client!, executor: deps.executor, modelId: deps.modelId! })
    : createRuleBrain({ executor: deps.executor });
  const brainName = useBedrock ? "bedrock" : "rules";

  return {
    brainName,
    async handle(utterance, history = []) {
      const result = await brain.respond(utterance, history);
      return { ...result, brain: brainName };
    }
  };
}
