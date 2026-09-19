import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";
import { renderScreen, type ScreenInput } from "./screens.js";

const app = new App({ name: "wayfinder-view", version: "0.1.0" });
const root = document.getElementById("root") as HTMLElement;
let current: ScreenInput = { toolName: "", arguments: {} };

function paint(): void {
  root.innerHTML = renderScreen(current);
  // Report height so the host can size the iframe.
  void app.sendSizeChanged({ height: document.documentElement.scrollHeight });
}

app.ontoolinput = (params: { arguments?: Record<string, unknown> }) => {
  current = { ...current, arguments: params.arguments ?? {} };
  paint();
};

app.ontoolresult = (params: { structuredContent?: unknown }) => {
  current = { ...current, result: params.structuredContent };
  paint();
};

// The tool name is not in the notification payload on all hosts; derive the
// screen from the result shape when it is absent.
new ResizeObserver(() => void app.sendSizeChanged({ height: document.documentElement.scrollHeight })).observe(document.body);

void app.connect(transportFromHost());

function transportFromHost(): PostMessageTransport {
  return new PostMessageTransport(window.parent, window.parent);
}
