import type { LoadedImage } from "../scan/imageSource.js";

export interface ToolSpec {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ChatMessage =
  | { role: "system"; text: string }
  | { role: "user"; text?: string; images?: LoadedImage[] }
  | { role: "assistant"; text?: string; toolCalls?: ToolCall[] }
  | { role: "tool"; results: Array<{ id: string; text: string; isError: boolean }> };

export type Protocol = "openai-compatible" | "anthropic-messages" | "bedrock-converse";

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface ChatProvider {
  readonly id: string;
  readonly protocol: Protocol;
  readonly supportsImages: boolean;
  chat(request: { messages: ChatMessage[]; tools?: ToolSpec[]; maxTokens?: number }): Promise<ChatResult>;
}
