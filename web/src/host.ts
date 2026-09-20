import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AppBridge, PostMessageTransport, getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolResultSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpUiHostCapabilities } from "@modelcontextprotocol/ext-apps/app-bridge";
import { pickUiTool, scanIsIncomplete } from "./uiTools.js";

export { pickUiTool };

export interface AppHostCall { name: string; input: Record<string, unknown> }

const HOST_INFO = { name: "wayfinder-sim-host", version: "0.1.0" };
const HOST_CAPABILITIES: McpUiHostCapabilities = { openLinks: {}, serverTools: {}, logging: {} };

export function createAppHost(deps: { mount: HTMLElement }): {
  handleToolCalls(calls: AppHostCall[]): Promise<void>;
  reset(): void;
} {
  const client = new Client(HOST_INFO);
  let connected: Promise<void> | undefined;
  const ensure = (): Promise<void> => {
    if (!connected) {
      const transport = new StreamableHTTPClientTransport(new URL(`${location.origin}/mcp`)) as unknown as Transport;
      connected = client.connect(transport).catch((err: unknown) => {
        connected = undefined;
        throw err;
      });
    }
    return connected;
  };

  let bridge: AppBridge | undefined;
  let iframe: HTMLIFrameElement | undefined;
  let uiToolNames: string[] | undefined;
  let pendingInput: Record<string, unknown> = {};
  let pendingResult: CallToolResult | undefined;
  let initialized = false;
  let generation = 0;
  let chain: Promise<void> = Promise.resolve();

  async function listTools(): Promise<Tool[]> {
    await ensure();
    const { tools } = await client.listTools();
    return tools;
  }

  async function derivedUiTools(): Promise<readonly string[]> {
    if (!uiToolNames) {
      const tools = await listTools();
      uiToolNames = tools.filter((tool) => getToolUiResourceUri(tool) !== undefined).map((tool) => tool.name);
    }
    return uiToolNames;
  }

  function discardView(): void {
    void bridge?.close();
    bridge = undefined;
    iframe = undefined;
    initialized = false;
    pendingInput = {};
    pendingResult = undefined;
  }

  function sendPending(): void {
    if (!bridge || !pendingResult || !initialized) return;
    void bridge.sendToolInput({ arguments: pendingInput });
    void bridge.sendToolResult(pendingResult);
  }

  async function render(name: string, input: Record<string, unknown>, result: CallToolResult, gen: number): Promise<void> {
    if (iframe && !deps.mount.contains(iframe)) {
      // The shell cleared the mount (Reset): drop the detached View and build a fresh one.
      discardView();
    }

    const tools = await listTools();
    if (gen !== generation) return;
    const tool = tools.find((t) => t.name === name);
    const uri = tool ? getToolUiResourceUri(tool) : undefined;
    if (!tool || !uri) return;

    pendingInput = input;
    pendingResult = result;

    if (!iframe) {
      const frame = document.createElement("iframe");
      frame.title = "Wayfinder view";
      frame.setAttribute("sandbox", "allow-scripts");
      frame.style.cssText = "width:100%;border:0;border-radius:12px;background:transparent;";
      deps.mount.replaceChildren(frame);
      const frameWindow = frame.contentWindow;
      if (!frameWindow) return;

      const hostBridge = new AppBridge(client, HOST_INFO, HOST_CAPABILITIES, {
        hostContext: { toolInfo: { tool } }
      });
      hostBridge.onsizechange = ({ height }) => {
        if (typeof height === "number") frame.style.height = `${height}px`;
      };
      hostBridge.oninitialized = () => {
        initialized = true;
        sendPending();
      };

      let html = "";
      try {
        await hostBridge.connect(new PostMessageTransport(frameWindow, frameWindow));
        if (gen !== generation) {
          void hostBridge.close();
          frame.remove();
          return;
        }
        const read = await client.readResource({ uri });
        if (gen !== generation) {
          void hostBridge.close();
          frame.remove();
          return;
        }
        const content = read.contents[0];
        if (content && "text" in content) html = content.text;
      } catch (err) {
        console.error("[host] failed to load the app view:", err);
      }

      if (!html) {
        void hostBridge.close();
        frame.remove();
        return;
      }
      if (gen !== generation) {
        void hostBridge.close();
        frame.remove();
        return;
      }

      frame.srcdoc = html;
      iframe = frame;
      bridge = hostBridge;
      return;
    }

    if (gen !== generation) return;
    if (bridge) {
      bridge.setHostContext({ toolInfo: { tool } });
      sendPending();
    }
  }

  async function callTool(name: string, input: Record<string, unknown>): Promise<CallToolResult> {
    return client.request(
      { method: "tools/call", params: { name, arguments: input } },
      CallToolResultSchema
    );
  }

  async function doHandle(calls: AppHostCall[], gen: number): Promise<void> {
    const uiCall = pickUiTool(calls, await derivedUiTools());
    if (!uiCall) return;
    if (gen !== generation) return;

    await ensure();
    if (gen !== generation) return;

    let result = await callTool(uiCall.name, uiCall.input);
    if (gen !== generation) return;

    if (uiCall.name === "get_scan" && scanIsIncomplete(result)) {
      const scanId = uiCall.input.scanId;
      if (typeof scanId === "string") {
        for (let i = 0; i < 15 && scanIsIncomplete(result); i++) {
          await new Promise<void>((resolve) => setTimeout(resolve, 1000));
          if (gen !== generation) return;
          result = await callTool("get_scan", { scanId });
          if (gen !== generation) return;
        }
      }
    }

    await render(uiCall.name, uiCall.input, result, gen);
  }

  return {
    handleToolCalls(calls: AppHostCall[]): Promise<void> {
      const gen = generation;
      const run = chain.then(() => doHandle(calls, gen));
      chain = run.catch(() => {});
      return run;
    },
    reset(): void {
      generation += 1;
      discardView();
    }
  };
}
