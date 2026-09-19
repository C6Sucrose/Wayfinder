import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";
import { renderScreen, type ScreenInput } from "./screens.js";
import { toolNameFromHostContext } from "./hostContext.js";

const app = new App({ name: "wayfinder-view", version: "0.1.0" });
const root = document.getElementById("root") as HTMLElement;
let current: ScreenInput = { toolName: "", arguments: {} };

function paint(): void {
  root.innerHTML = renderScreen(current);
  // Report height so the host can size the iframe.
  void app.sendSizeChanged({ height: document.documentElement.scrollHeight });
}

function applyHostContext(context: unknown): void {
  const toolName = toolNameFromHostContext(context);
  if (toolName && toolName !== current.toolName) {
    current = { ...current, toolName };
    paint();
  }
}

app.ontoolinput = (params: { arguments?: Record<string, unknown> }) => {
  current = { ...current, arguments: params.arguments ?? {} };
  paint();
};

app.ontoolresult = (params: { structuredContent?: unknown }) => {
  current = { ...current, result: params.structuredContent };
  paint();
};

// The tool that produced this View arrives through host context
// (`toolInfo.tool.name`); paint once it is known and whenever it changes.
app.onhostcontextchanged = (params: unknown) => {
  applyHostContext(params);
};

new ResizeObserver(() => void app.sendSizeChanged({ height: document.documentElement.scrollHeight })).observe(document.body);

void app
  .connect(transportFromHost())
  .then(() => applyHostContext(app.getHostContext()))
  .catch((err: unknown) => console.error("[view] connect failed:", err));

function transportFromHost(): PostMessageTransport {
  return new PostMessageTransport(window.parent, window.parent);
}
