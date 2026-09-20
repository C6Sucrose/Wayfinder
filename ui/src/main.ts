import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";
import { renderScreen, type ScreenInput } from "./screens.js";
import { toolNameFromHostContext } from "./hostContext.js";

const app = new App({ name: "wayfinder-view", version: "0.1.0" });
const root = document.getElementById("root") as HTMLElement;
let current: ScreenInput = { toolName: "", arguments: {} };

function paint(): void {
  root.innerHTML = renderScreen(current);
  wireActions();
  // Report height so the host can size the iframe.
  void app.sendSizeChanged({ height: document.documentElement.scrollHeight });
}

function wireActions(): void {
  root.querySelectorAll<HTMLButtonElement>("button.action").forEach((button) => {
    button.addEventListener("click", () => void handleAction(button));
  });
}

async function handleAction(button: HTMLButtonElement): Promise<void> {
  const itemId = button.dataset.itemId;
  const actionId = button.dataset.actionId;
  if (!itemId || !actionId) return;
  if (!window.confirm("Carry out this action?")) return;
  button.disabled = true;
  try {
    const res = await app.callServerTool({ name: "act_on_item", arguments: { itemId, actionId } });
    current = { ...current, toolName: "act_on_item", result: res.structuredContent };
  } catch (err) {
    console.error("[view] action failed:", err);
    return;
  } finally {
    button.disabled = false;
  }
  paint();
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
