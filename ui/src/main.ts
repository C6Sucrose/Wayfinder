import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";
import { renderConfirm, renderScreen, type ScreenInput } from "./screens.js";
import { toolNameFromHostContext } from "./hostContext.js";

const app = new App({ name: "wayfinder-view", version: "0.1.0" });
const root = document.getElementById("root") as HTMLElement;
let current: ScreenInput = { toolName: "", arguments: {} };
let pendingAction: { itemId: string; actionId: string; type: string } | undefined;

function paint(): void {
  root.innerHTML = renderScreen(current) + (pendingAction ? renderConfirm(pendingAction) : "");
  wireActions();
  wireConfirm();
  // Report height so the host can size the iframe.
  void app.sendSizeChanged({ height: document.documentElement.scrollHeight });
}

function wireActions(): void {
  root.querySelectorAll<HTMLButtonElement>("button.action").forEach((button) => {
    button.addEventListener("click", () => {
      const itemId = button.dataset.itemId;
      const actionId = button.dataset.actionId;
      if (!itemId || !actionId) return;
      pendingAction = { itemId, actionId, type: button.textContent ?? "" };
      paint();
    });
  });
}

function wireConfirm(): void {
  root.querySelector<HTMLButtonElement>(".confirm__no")?.addEventListener("click", () => {
    pendingAction = undefined;
    paint();
  });
  const yes = root.querySelector<HTMLButtonElement>(".confirm__yes");
  if (yes) yes.addEventListener("click", () => void confirmAction(yes));
}

async function confirmAction(button: HTMLButtonElement): Promise<void> {
  const pending = pendingAction;
  if (!pending) return;
  button.disabled = true;
  try {
    const res = await app.callServerTool({
      name: "act_on_item",
      arguments: { itemId: pending.itemId, actionId: pending.actionId }
    });
    pendingAction = undefined;
    current = { ...current, toolName: "act_on_item", result: res.structuredContent };
  } catch (err) {
    console.error("[view] action failed:", err);
    pendingAction = undefined;
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
