import type { BedrockConverseLike } from "../scan/bedrockExtractor.js";
import type { McpExecutor } from "./mcpExecutor.js";
import { createBedrockBrain } from "./bedrockBrain.js";
import { createProviderBrain } from "./providerBrain.js";
import { createRuleBrain } from "./ruleBrain.js";
import type { AgentResult, Brain, HistoryEntry } from "./types.js";
import type { ChatProvider } from "../providers/types.js";

export interface AgentService {
  brainName: "rules" | "bedrock" | string;
  handle(utterance: string, history?: HistoryEntry[]): Promise<AgentResult & { brain: "rules" | "bedrock" | string }>;
}

export function createAgentService(deps: {
  executor: McpExecutor;
  client?: BedrockConverseLike;
  modelId?: string;
  provider?: ChatProvider;
  providerName?: string;
  maxRounds?: number;
}): AgentService {
  const useProvider = deps.provider !== undefined;
  const useBedrock = !useProvider && Boolean(deps.client && deps.modelId);
  const brain: Brain = useProvider
    ? createProviderBrain({
        provider: deps.provider!,
        executor: deps.executor,
        ...(deps.maxRounds !== undefined ? { maxRounds: deps.maxRounds } : {})
      })
    : useBedrock
      ? createBedrockBrain({ client: deps.client!, executor: deps.executor, modelId: deps.modelId! })
      : createRuleBrain({ executor: deps.executor });
  const brainName = useProvider ? (deps.providerName ?? deps.provider!.id) : useBedrock ? "bedrock" : "rules";

  return {
    brainName,
    async handle(utterance, history = []) {
      const result = await brain.respond(utterance, history);
      return { ...result, brain: brainName };
    }
  };
}
