import { describe, it, expect } from "vitest";
import { createOpenAICompatProvider } from "../../src/providers/openaiCompat.js";

function fakeFetch(body: unknown, capture?: (url: string, init: RequestInit) => void) {
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    capture?.(String(url), init ?? {});
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
}

const bytes = new Uint8Array([1, 2, 3]);

interface ImageBody {
  messages: [{ content: [unknown, { image_url: { url: string } }] }];
  tools: [{ function: { name: string } }];
}

interface ToolBody {
  messages: [
    { tool_calls: [{ id: string }] },
    { role: "tool"; tool_call_id: string; content: string }
  ];
}

describe("createOpenAICompatProvider", () => {
  it("sends tools and images and parses tool calls", async () => {
    let url = "";
    let sent!: ImageBody;
    const provider = createOpenAICompatProvider({
      id: "openai", baseUrl: "https://api.test/v1", apiKey: "secret", model: "m", supportsImages: true, timeoutMs: 1000,
      fetchImpl: fakeFetch({
        choices: [{ message: { content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "get_backlog", arguments: "{\"x\":1}" } }] } }],
        usage: { prompt_tokens: 5, completion_tokens: 2 }
      }, (u, i) => { url = u; sent = JSON.parse(String(i.body)); })
    });
    const result = await provider.chat({
      messages: [{ role: "user", text: "hi", images: [{ bytes, format: "png" }] }],
      tools: [{ name: "get_backlog", inputSchema: { type: "object" } }]
    });
    expect(url).toBe("https://api.test/v1/chat/completions");
    expect(sent.messages[0].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
    expect(sent.tools[0].function.name).toBe("get_backlog");
    expect(result.toolCalls).toEqual([{ id: "t1", name: "get_backlog", input: { x: 1 } }]);
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
  });

  it("returns plain text", async () => {
    const provider = createOpenAICompatProvider({
      id: "openai", baseUrl: "https://api.test/v1", apiKey: "k", model: "m", supportsImages: false, timeoutMs: 1000,
      fetchImpl: fakeFetch({ choices: [{ message: { content: "hello" } }] })
    });
    expect((await provider.chat({ messages: [{ role: "user", text: "hi" }] })).text).toBe("hello");
  });

  it("expands tool results into tool messages", async () => {
    let sent!: ToolBody;
    const provider = createOpenAICompatProvider({
      id: "openai", baseUrl: "https://api.test/v1", apiKey: "k", model: "m", supportsImages: false, timeoutMs: 1000,
      fetchImpl: fakeFetch({ choices: [{ message: { content: "done" } }] }, (_u, i) => { sent = JSON.parse(String(i.body)); })
    });
    await provider.chat({ messages: [
      { role: "assistant", toolCalls: [{ id: "t1", name: "t", input: {} }] },
      { role: "tool", results: [{ id: "t1", text: "ok", isError: false }] }
    ] });
    expect(sent.messages[0].tool_calls[0].id).toBe("t1");
    expect(sent.messages[1]).toMatchObject({ role: "tool", tool_call_id: "t1", content: "ok" });
  });

  it("throws on a non-2xx response without leaking the key", async () => {
    const provider = createOpenAICompatProvider({
      id: "openai", baseUrl: "https://api.test/v1", apiKey: "super-secret", model: "m", supportsImages: false, timeoutMs: 1000,
      fetchImpl: async () => new Response("nope", { status: 401 })
    });
    await expect(provider.chat({ messages: [{ role: "user", text: "hi" }] })).rejects.toThrow(/401/);
    await provider.chat({ messages: [{ role: "user", text: "hi" }] }).catch((e: Error) => {
      expect(e.message).not.toContain("super-secret");
    });
  });
});
