import type { McpExecutor } from "./mcpExecutor.js";
import type { AgentResult, Brain } from "./types.js";

interface Intent {
  pattern: RegExp;
  name: string;
  input: (m: RegExpMatchArray) => Record<string, unknown>;
}

const FALLBACK = "daily_briefing";

export function createRuleBrain(deps: { executor: McpExecutor; demoImageRef?: string }): Brain {
  const demoImageRef = deps.demoImageRef ?? "demo";
  const intents: Intent[] = [
    { pattern: /read|scan|look at/i, name: "capture_scan", input: () => ({ imageRefs: [demoImageRef], hint: "mail" }) },
    { pattern: /label|ingredient|expiry|use by/i, name: "identify_product", input: () => ({ imageRefs: [demoImageRef] }) },
    { pattern: /where (?:is|are) my (.+)/i, name: "find_object", input: (m) => ({ name: (m[1] ?? "").replace(/[?.!]/g, "").trim() }) },
    { pattern: /remember (?:my )?(.+?) (?:is|are) (?:on|in|at) (.+)/i, name: "remember_object",
      input: (m) => ({ name: (m[1] ?? "").trim(), locationNote: (m[2] ?? "").replace(/[.]/g, "").trim() }) },
    { pattern: /briefing|what.*(?:due|owe)|today/i, name: "daily_briefing", input: () => ({}) }
  ];

  return {
    async respond(utterance): Promise<AgentResult> {
      const intent = intents.find((i) => i.pattern.test(utterance));
      const name = intent?.name ?? FALLBACK;
      const match = intent?.pattern.exec(utterance) ?? ([""] as unknown as RegExpMatchArray);
      const input = intent ? intent.input(match) : {};
      const outcome = await deps.executor.callTool(name, input);
      return { reply: outcome.text || "Done.", toolCalls: [{ name, input }] };
    }
  };
}
