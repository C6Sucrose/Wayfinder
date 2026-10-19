import type { ChatMessage, ChatProvider, ChatResult, ToolCall, ToolSpec } from "./types.js";

type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface OpenAICompatOptions {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  supportsImages: boolean;
  timeoutMs: number;
  authHeader?: "authorization" | "api-key";
  query?: Record<string, string>;
  fetchImpl?: FetchLike;
  maxTokens?: number;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

function toOpenAIMessages(messages: ChatMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const message of messages) {
    if (message.role === "system") { out.push({ role: "system", content: message.text }); continue; }
    if (message.role === "assistant") {
      const entry: Record<string, unknown> = { role: "assistant", content: message.text ?? null };
      if (message.toolCalls?.length) {
        entry.tool_calls = message.toolCalls.map((call) => ({
          id: call.id, type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.input) }
        }));
      }
      out.push(entry);
      continue;
    }
    if (message.role === "tool") {
      for (const result of message.results) {
        out.push({ role: "tool", tool_call_id: result.id, content: result.text });
      }
      continue;
    }
    if (message.images?.length) {
      const parts: unknown[] = [];
      if (message.text) parts.push({ type: "text", text: message.text });
      for (const image of message.images) {
        parts.push({ type: "image_url", image_url: { url: `data:image/${image.format};base64,${Buffer.from(image.bytes).toString("base64")}` } });
      }
      out.push({ role: "user", content: parts });
    } else {
      out.push({ role: "user", content: message.text ?? "" });
    }
  }
  return out;
}

export function createOpenAICompatProvider(options: OpenAICompatOptions): ChatProvider {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const url = (() => {
    const parsed = new URL(`${options.baseUrl.replace(/\/$/, "")}/chat/completions`);
    for (const [key, value] of Object.entries(options.query ?? {})) parsed.searchParams.set(key, value);
    return parsed.toString();
  })();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if ((options.authHeader ?? "authorization") === "api-key") headers["api-key"] = options.apiKey;
  else headers.authorization = `Bearer ${options.apiKey}`;

  return {
    id: options.id,
    protocol: "openai-compatible",
    supportsImages: options.supportsImages,
    async chat(request): Promise<ChatResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const body: Record<string, unknown> = { model: options.model, messages: toOpenAIMessages(request.messages) };
        if (request.tools?.length) {
          body.tools = request.tools.map((tool: ToolSpec) => ({
            type: "function",
            function: { name: tool.name, ...(tool.description !== undefined ? { description: tool.description } : {}), parameters: tool.inputSchema }
          }));
          body.tool_choice = "auto";
        }
        if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
        else if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;

        const response = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
        if (!response.ok) throw new Error(`provider ${options.id} returned ${response.status}`);
        const json = (await response.json()) as {
          choices?: Array<{ message?: { content?: string | null; tool_calls?: OpenAIToolCall[] } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const message = json.choices?.[0]?.message ?? {};
        const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((call) => ({
          id: call.id,
          name: call.function.name,
          input: safeParse(call.function.arguments)
        }));
        const usage = json.usage
          ? { ...(json.usage.prompt_tokens !== undefined ? { inputTokens: json.usage.prompt_tokens } : {}), ...(json.usage.completion_tokens !== undefined ? { outputTokens: json.usage.completion_tokens } : {}) }
          : undefined;
        return { text: message.content ?? "", toolCalls, ...(usage !== undefined ? { usage } : {}) };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

function safeParse(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
