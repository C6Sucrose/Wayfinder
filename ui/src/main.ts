import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";
import { renderConfirm, renderPending, renderScreen, type ScreenInput } from "./screens.js";
import { toolNameFromHostContext } from "./hostContext.js";

const app = new App({ name: "wayfinder-view", version: "0.1.0" });
const root = document.getElementById("root") as HTMLElement;
const announcer = document.getElementById("announcer") as HTMLElement | null;
let current: ScreenInput = { toolName: "", arguments: {} };
let pendingAction: { itemId: string; actionId: string; type: string } | undefined;
let focusedBeforeDialog: HTMLElement | null = null;
let pending = false;
let fontsInjected = false;

function announce(message: string): void {
  if (announcer) announcer.textContent = message;
}

function paint(): void {
  root.innerHTML = (pending ? renderPending() : renderScreen(current)) + (pendingAction ? renderConfirm(pendingAction) : "");
  wireActions();
  wireConfirm();
  wireEscalate();
  wireCopy();
  wireRecheck();
  wireHistory();
  if (pendingAction) {
    root.querySelector<HTMLButtonElement>(".confirm__yes")?.focus();
  }
  void app.sendSizeChanged({ height: document.documentElement.scrollHeight });
}

function wireActions(): void {
  root.querySelectorAll<HTMLButtonElement>("button.action").forEach((button) => {
    button.addEventListener("click", () => {
      const itemId = button.dataset.itemId;
      const actionId = button.dataset.actionId;
      if (!itemId || !actionId) return;
      focusedBeforeDialog = button;
      pendingAction = { itemId, actionId, type: button.textContent ?? "" };
      paint();
    });
  });
}

function wireConfirm(): void {
  root.querySelector<HTMLButtonElement>(".confirm__no")?.addEventListener("click", () => {
    pendingAction = undefined;
    paint();
    focusedBeforeDialog?.focus();
    focusedBeforeDialog = null;
  });
  const yes = root.querySelector<HTMLButtonElement>(".confirm__yes");
  if (yes) yes.addEventListener("click", () => void confirmAction(yes));
}

async function confirmAction(button: HTMLButtonElement): Promise<void> {
  const pending2 = pendingAction;
  if (!pending2) return;
  button.disabled = true;
  pending = true;
  paint();
  try {
    const res = await app.callServerTool({
      name: "act_on_item",
      arguments: { itemId: pending2.itemId, actionId: pending2.actionId, confirmed: true }
    });
    pendingAction = undefined;
    current = {
      ...current,
      toolName: "act_on_item",
      result: res.isError || res.structuredContent === undefined ? { failed: true } : res.structuredContent
    };
  } catch (err) {
    console.error("[view] action failed:", err);
    pendingAction = undefined;
    current = { ...current, toolName: "act_on_item", result: { failed: true } };
  } finally {
    pending = false;
  }
  paint();
}

function wireEscalate(): void {
  root.querySelectorAll<HTMLButtonElement>("button.escalate").forEach((button) => {
    button.addEventListener("click", () => void callAndShow(button, "escalate_item", { documentId: button.dataset.documentId }));
  });
}

function wireRecheck(): void {
  root.querySelectorAll<HTMLButtonElement>("button.recheck").forEach((button) => {
    button.addEventListener("click", () => void callAndShow(button, "verify_ledger", {}));
  });
}

function wireHistory(): void {
  root.querySelectorAll<HTMLButtonElement>("button.view-history").forEach((button) => {
    button.addEventListener("click", () => void callAndShow(button, "get_audit", { threadKey: button.dataset.threadKey }));
  });
}

async function callAndShow(
  button: HTMLButtonElement,
  name: string,
  args: Record<string, unknown> | undefined
): Promise<void> {
  if (args && Object.values(args).some((value) => value === undefined)) return;
  button.disabled = true;
  pending = true;
  paint();
  try {
    const res = await app.callServerTool({ name, arguments: args ?? {} });
    current = {
      ...current,
      toolName: name,
      result: res.isError || res.structuredContent === undefined ? { failed: true } : res.structuredContent
    };
  } catch (err) {
    console.error(`[view] ${name} failed:`, err);
    current = { ...current, toolName: name, result: { failed: true } };
  } finally {
    pending = false;
  }
  paint();
}

function wireCopy(): void {
  root.querySelectorAll<HTMLButtonElement>("button.copy").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.copy ?? "";
      const done = (): void => {
        button.textContent = "Copied";
        announce("Fingerprint copied.");
        window.setTimeout(() => {
          button.textContent = "Copy";
        }, 1500);
      };
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(value).then(done, done);
      } else {
        done();
      }
    });
  });
}

function applyStyles(context: Record<string, unknown>): void {
  document.documentElement.setAttribute("data-theme", context.theme === "dark" ? "dark" : "light");

  const styles = context.styles as { variables?: Record<string, unknown>; css?: { fonts?: unknown } } | undefined;
  if (styles?.variables) {
    for (const [key, value] of Object.entries(styles.variables)) {
      if (typeof value === "string") document.documentElement.style.setProperty(key, value);
    }
  }
  if (!fontsInjected && typeof styles?.css?.fonts === "string" && styles.css.fonts) {
    const tag = document.createElement("style");
    tag.textContent = styles.css.fonts;
    document.head.append(tag);
    fontsInjected = true;
  }

  const size = context.textSize;
  if (size === "large" || size === "x-large") {
    document.documentElement.setAttribute("data-text-size", size);
  } else {
    document.documentElement.removeAttribute("data-text-size");
  }
}

function applyHostContext(context: unknown): void {
  if (typeof context !== "object" || context === null) return;
  applyStyles(context as Record<string, unknown>);
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
