# Wayfinder — Plan 4: MCP Apps UI & Simulated Alexa+ Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Wayfinder an interactive UI that renders inside an MCP host, and build the simulated Alexa+ client that exercises it by voice — the demo centerpiece.

**Architecture:** Two halves that meet at MCP Apps.
1. **Server half:** a single-file HTML View, built by esbuild, registered as the `ui://wayfinder/app.html` resource via `registerAppResource`, and referenced from the six display-worthy tools via `registerAppTool`'s `_meta.ui.resourceUri`.
2. **Client half:** a Vite (vanilla TS) web app styled as an Echo-Show device. It uses `@modelcontextprotocol/ext-apps/app-bridge` `AppBridge` + `PostMessageTransport` to render the View in a sandboxed iframe, sends tool input/result into it, and drives conversation through the server's `POST /api/agent`.

**Tech Stack:** existing stack plus `@modelcontextprotocol/ext-apps@^1.7.5`, `esbuild` (View bundle), `vite` (client dev server). No React.

**Spec:** `docs/superpowers/specs/2026-09-19-wayfinder-design.md`

## Global Constraints

- Node **22+**; ESM (`"type": "module"`).
- **ext-apps `^1.7.5`** — pinned to the 1.x line because 2.x requires `@modelcontextprotocol/server|client|core@^2` and `zod@^4`. Do **not** upgrade the MCP SDK in this plan.
- MCP Apps resource MIME is `text/html;profile=mcp-app` (`RESOURCE_MIME_TYPE`); resource URIs start with `ui://`.
- Voice-first: every View's information is also in the tool's `content[0].text`; the View is an enhancement, never the only path.
- No IDs, URLs, JSON, or tool names in customer-facing text.
- All spoken strings live in `src/domain/copy.ts`.
- The View bundle must be **self-contained** (no external network origins) and is served from the existing server; keep the resource CSP empty unless a network origin is genuinely required.
- Accessibility: ≥48 px touch targets, host theme variables honoured, WCAG-AA contrast, keyboard reachable.
- Existing 153 tests must stay green.

---

## File Structure

```
package.json                     MODIFY add ext-apps, esbuild, vite; add ui/client scripts
ui/src/main.ts                   CREATE View entry: receives tool input/result, renders a screen
ui/src/screens.ts                CREATE pure screen builders (dashboard, inbox, item, label, briefing)
ui/src/styles.css                CREATE tokens + layout using host theme variables
ui/build.mjs                     CREATE esbuild build -> dist/ui/app.html (single file)
src/mcp/appResource.ts           CREATE readAppHtml() + APP_RESOURCE_URI + UI_TOOLS
src/mcp/server.ts                MODIFY register the app resource; attach UI metadata to 6 tools
web/index.html                   CREATE device frame + transcript + controls
web/src/main.ts                  CREATE client: voice, /api/agent, AppBridge host, iframe
web/src/host.ts                  CREATE createAppHost(): AppBridge + PostMessageTransport wiring
web/src/styles.css               CREATE device-frame styling
web/vite.config.ts               CREATE dev server + proxy to the MCP server
test/appResource.test.ts         CREATE resource registered, MIME, HTML non-empty, no external origins
test/uiMeta.test.ts              CREATE the 6 tools expose _meta.ui.resourceUri
docs/demo-script.md              CREATE the 3-minute demo beats
```

---

### Task 1: View bundle build pipeline

**Files:**
- Create: `ui/src/main.ts`, `ui/src/screens.ts`, `ui/src/styles.css`, `ui/build.mjs`
- Modify: `package.json`
- Test: `test/uiBundle.test.ts`

**Interfaces:**
- Produces:
  - `ui/build.mjs` → writes `dist/ui/app.html`, a **single self-contained HTML file** with the JS and CSS inlined.
  - `npm run build:ui` runs it; `npm run build` also runs it.
  - Screen contract (used by Task 2 and the View): `renderScreen(input: { toolName: string; arguments: Record<string, unknown>; result?: unknown }): string` returns an HTML fragment string.

- [ ] **Step 1: Add dependencies**

Run: `npm install -D esbuild@^0.25.0`
Expected: `esbuild` in devDependencies.

- [ ] **Step 2: Write the failing test** — create `test/uiBundle.test.ts`

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const OUT = "dist/ui/app.html";

describe("ui bundle", () => {
  beforeAll(() => {
    execFileSync(process.execPath, ["ui/build.mjs"], { stdio: "pipe" });
  });

  it("builds a single self-contained HTML file", () => {
    expect(existsSync(OUT)).toBe(true);
    const html = readFileSync(OUT, "utf8");
    expect(html).toMatch(/<!doctype html>/i);
    expect(html.length).toBeGreaterThan(500);
    // self-contained: no external script/style/stylesheet origins
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet["']/i);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/uiBundle.test.ts`
Expected: FAIL — `ui/build.mjs` not found.

- [ ] **Step 4: Implement the screens module** — `ui/src/screens.ts`

```ts
export interface ScreenInput {
  toolName: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

const escape = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );

function card(title: string, body: string, tone = ""): string {
  return `<article class="card${tone ? ` card--${tone}` : ""}"><h2>${escape(title)}</h2><div class="card__body">${body}</div></article>`;
}

function itemCard(item: Record<string, unknown>): string {
  const cls = String(item.class ?? "item");
  const text = escape(item.readAloudText ?? "");
  const due = item.fields && typeof item.fields === "object" && "dueDate" in (item.fields as object)
    ? escape((item.fields as Record<string, unknown>).dueDate)
    : "";
  const tone = cls === "scam" ? " alert" : cls === "label" ? " info" : "";
  const actions = Array.isArray(item.proposedActions)
    ? `<ul class="actions">${(item.proposedActions as Array<Record<string, unknown>>)
        .map((a) => `<li>${escape(a.type)}</li>`)
        .join("")}</ul>`
    : "";
  return card(`${cls}${due ? ` · due ${due}` : ""}`, `<p>${text}</p>${actions}`, tone);
}

export function renderScreen(input: ScreenInput): string {
  const result = (input.result ?? {}) as Record<string, unknown>;
  const items = Array.isArray(result.items) ? (result.items as Array<Record<string, unknown>>) : [];

  switch (input.toolName) {
    case "get_scan":
    case "list_items":
      return items.length
        ? `<section class="grid">${items.map(itemCard).join("")}</section>`
        : `<p class="empty">Nothing to show yet.</p>`;
    case "get_item":
      return result.item ? itemCard(result.item as Record<string, unknown>) : `<p class="empty">No item.</p>`;
    case "daily_briefing": {
      const due = Array.isArray(result.due) ? result.due.length : 0;
      const flagged = Array.isArray(result.flagged) ? result.flagged.length : 0;
      const appts = Array.isArray(result.appointments) ? result.appointments.length : 0;
      return `<section class="grid">${card("Due", `<p class="big">${due}</p>`)}${card("Appointments", `<p class="big">${appts}</p>`)}${card("Flagged", `<p class="big">${flagged}</p>`, flagged ? " alert" : "")}</section>`;
    }
    case "identify_product":
      return card(escape(result.name ?? "Label"), `<pre class="label">${escape(result.labelText ?? "")}</pre><p class="disclaimer">${escape(result.disclaimer ?? "")}</p>`);
    case "find_object": {
      const found = result.found as Record<string, unknown> | null | undefined;
      return found
        ? card(escape(found.name ?? "Object"), `<p>Last seen ${escape(found.locationNote)}</p>`)
        : `<p class="empty">I don't have a location for that.</p>`;
    }
    default:
      return `<p class="empty">Nothing to show yet.</p>`;
  }
}
```

- [ ] **Step 5: Implement the View entry** — `ui/src/main.ts`

The View talks to the host only through the ext-apps `App` bridge. The exact View-side API ships as types: **read `node_modules/@modelcontextprotocol/ext-apps/dist/src/app.d.ts` and use its real method names** (`connect`, `ontoolinput`, `ontoolresult`, `callServerTool`, `sendSizeChanged`, `requestDisplayMode`) — confirm each against that file before writing.

```ts
import { App } from "@modelcontextprotocol/ext-apps";
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
function transportFromHost(): never { throw new Error("wire to PostMessageTransport per app.d.ts"); }
```

Implement `transportFromHost` using the View-side `PostMessageTransport` the package exports (check `app.d.ts`/`message-transport` for the exact import and constructor arguments — the host side of the same class is used in Task 4).

- [ ] **Step 6: Implement `ui/src/styles.css`**

Use host theme variables with fallbacks so the View matches any host:

```css
:root {
  --wf-bg: var(--mcp-color-background, #ffffff);
  --wf-fg: var(--mcp-color-text, #111111);
  --wf-muted: var(--mcp-color-text-secondary, #555555);
  --wf-accent: var(--mcp-color-accent, #0a5bd3);
  --wf-alert-bg: #fff3f2; --wf-alert-fg: #8a1f11;
  --wf-radius: 12px; --wf-gap: 12px;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--wf-bg); color: var(--wf-fg); font: 16px/1.5 system-ui, sans-serif; }
.grid { display: grid; gap: var(--wf-gap); grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
.card { border: 1px solid color-mix(in srgb, var(--wf-fg) 15%, transparent); border-radius: var(--wf-radius); padding: 16px; }
.card h2 { margin: 0 0 8px; font-size: 1rem; text-transform: capitalize; }
.card--alert { background: var(--wf-alert-bg); color: var(--wf-alert-fg); }
.big { font-size: 2rem; margin: 0; }
.actions { margin: 8px 0 0; padding-left: 20px; }
.label { white-space: pre-wrap; font-family: inherit; }
.disclaimer { color: var(--wf-muted); font-size: 0.9rem; }
.empty { color: var(--wf-muted); }
button, .actions li { min-height: 48px; }
```

- [ ] **Step 7: Implement `ui/build.mjs`**

```js
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

await build({
  entryPoints: ["ui/src/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: true,
  write: false,
  outfile: "ui-out.js",
  loader: { ".css": "text" }
}).then((result) => {
  const js = result.outputFiles[0].text;
  const css = readFileSync("ui/src/styles.css", "utf8");
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Wayfinder</title><style>${css}</style></head>
<body><main id="root" role="main" aria-live="polite"></main><script>${js}</script></body>
</html>`;
  mkdirSync("dist/ui", { recursive: true });
  writeFileSync("dist/ui/app.html", html, "utf8");
  console.log(`[ui] wrote dist/ui/app.html (${html.length} bytes)`);
});
```

- [ ] **Step 8: Wire the scripts in `package.json`**

Add `"build:ui": "node ui/build.mjs"` and make `"build": "node ui/build.mjs && tsc -p tsconfig.json"`.

- [ ] **Step 9: Run the test, then the gates**

Run: `npx vitest run test/uiBundle.test.ts; if ($?) { npm run build }; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Expected: the bundle test passes; `dist/ui/app.html` exists and is self-contained. If `tsc` tries to compile `ui/src/*.ts`, add `ui` to `tsconfig.test.json`'s include or a `ui/tsconfig.json` so View code type-checks against the DOM lib — do not exclude it from typechecking.

- [ ] **Step 10: Commit**

```bash
git add ui package.json package-lock.json test/uiBundle.test.ts
git commit -m "feat(ui): add self-contained MCP App view bundle pipeline"
```

---

### Task 2: Register the app resource and UI metadata

**Files:**
- Create: `src/mcp/appResource.ts`
- Modify: `src/mcp/server.ts`
- Test: `test/appResource.test.ts`, `test/uiMeta.test.ts`

**Interfaces:**
- Produces:
  - `export const APP_RESOURCE_URI = "ui://wayfinder/app.html"`.
  - `export const UI_TOOLS = ["get_scan","list_items","get_item","daily_briefing","identify_product","find_object"] as const`.
  - `export function readAppHtml(): string` — reads `dist/ui/app.html`, throwing a clear error if missing.
- `buildServer` registers the resource with `registerAppResource` and the six tools with `registerAppTool` carrying `_meta: { ui: { resourceUri: APP_RESOURCE_URI } }`.

- [ ] **Step 1: Write the failing tests** — create `test/appResource.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFileStore } from "../src/storage/fileStore.js";
import { buildServer } from "../src/mcp/server.js";
import { APP_RESOURCE_URI } from "../src/mcp/appResource.js";

async function connect() {
  const server = buildServer({ store: createFileStore(mkdtempSync(join(tmpdir(), "wf-"))) });
  const client = new Client({ name: "t", version: "0.0.1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("app resource", () => {
  it("lists and reads the MCP App resource with the app MIME type", async () => {
    const client = await connect();
    const list = await client.listResources();
    expect(list.resources.map((r) => r.uri)).toContain(APP_RESOURCE_URI);
    const read = await client.readResource({ uri: APP_RESOURCE_URI });
    const first = read.contents[0] as { mimeType?: string; text?: string };
    expect(first.mimeType).toBe("text/html;profile=mcp-app");
    expect((first.text ?? "").length).toBeGreaterThan(500);
    await client.close();
  });
});
```

- [ ] **Step 2: Write the failing metadata test** — create `test/uiMeta.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFileStore } from "../src/storage/fileStore.js";
import { buildServer } from "../src/mcp/server.js";
import { APP_RESOURCE_URI, UI_TOOLS } from "../src/mcp/appResource.js";

describe("UI tool metadata", () => {
  it("exposes _meta.ui.resourceUri on exactly the display tools", async () => {
    const server = buildServer({ store: createFileStore(mkdtempSync(join(tmpdir(), "wf-"))) });
    const client = new Client({ name: "t", version: "0.0.1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const { tools } = await client.listTools();
    for (const name of UI_TOOLS) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      const ui = (tool!._meta as { ui?: { resourceUri?: string } } | undefined)?.ui;
      expect(ui?.resourceUri, name).toBe(APP_RESOURCE_URI);
    }
    await client.close();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/appResource.test.ts test/uiMeta.test.ts`
Expected: FAIL — `src/mcp/appResource.ts` not found; resource not listed.

- [ ] **Step 4: Implement `src/mcp/appResource.ts`**

```ts
import { readFileSync, existsSync } from "node:fs";

export const APP_RESOURCE_URI = "ui://wayfinder/app.html";
export const UI_TOOLS = [
  "get_scan", "list_items", "get_item", "daily_briefing", "identify_product", "find_object"
] as const;

export function readAppHtml(): string {
  const path = "dist/ui/app.html";
  if (!existsSync(path)) {
    throw new Error(`UI bundle missing at ${path}. Run: npm run build:ui`);
  }
  return readFileSync(path, "utf8");
}
```

- [ ] **Step 5: Register the resource and attach UI metadata in `src/mcp/server.ts`**

Import the helpers:

```ts
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { APP_RESOURCE_URI, UI_TOOLS, readAppHtml } from "./appResource.js";
```

At the end of `buildServer`, before `return server;`, register the resource:

```ts
  registerAppResource(
    server,
    "Wayfinder View",
    APP_RESOURCE_URI,
    { description: "Interactive Wayfinder cards: inbox, item detail, briefing, labels." },
    async () => ({
      contents: [{ uri: APP_RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: readAppHtml() }]
    })
  );
```

Then convert the six display tools from `server.tool(...)` to `registerAppTool(server, name, { ...config, _meta: { ui: { resourceUri: APP_RESOURCE_URI } } }, handler)` — keeping each existing description, input schema, and handler body byte-identical. The other tools stay on `server.tool`.

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run test/appResource.test.ts test/uiMeta.test.ts`
Expected: PASS.

- [ ] **Step 7: Gates and commit**

Run: `npm run build; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`

```bash
git add src/mcp/appResource.ts src/mcp/server.ts test/appResource.test.ts test/uiMeta.test.ts
git commit -m "feat(mcp): register the MCP App resource and UI metadata on display tools"
```

---

### Task 3: Simulated Alexa+ client shell

**Files:**
- Create: `web/index.html`, `web/vite.config.ts`, `web/src/main.ts`, `web/src/styles.css`
- Modify: `package.json`
- Test: none automated (the shell is verified by the Task 4 smoke check and the demo script)

**Interfaces:**
- Produces: `npm run dev:web` serves the client; it renders a device frame, a transcript, a push-to-talk button, a text input, and an event log of `{ brain, toolCalls }` returned by `/api/agent`.
- Consumes: `POST /api/agent` (Plan 3) returning `{ reply, brain, toolCalls }`.

- [ ] **Step 1: Add dependencies and scripts**

Run: `npm install -D vite@^6`
Add `"dev:web": "vite --config web/vite.config.ts"` and `"build:web": "vite build --config web/vite.config.ts"`.

- [ ] **Step 2: Implement `web/vite.config.ts`**

```ts
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8080", changeOrigin: false },
      "/mcp": { target: "http://127.0.0.1:8080", changeOrigin: false }
    }
  },
  build: { outDir: "../dist/web", emptyOutDir: true }
});
```

- [ ] **Step 3: Implement `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Wayfinder — Alexa+ simulation</title>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <main class="stage">
      <section class="device" aria-label="Simulated Alexa+ device">
        <header class="device__bar"><span class="device__title">Wayfinder</span><span id="brain" class="badge" aria-live="polite">rules</span></header>
        <div id="screen" class="device__screen"></div>
        <div class="device__controls">
          <button id="talk" type="button" aria-pressed="false">Hold to talk</button>
          <form id="type-form"><label class="sr-only" for="utterance">Type a request</label><input id="utterance" autocomplete="off" placeholder="Type a request…" /><button type="submit">Send</button></form>
        </div>
      </section>
      <aside class="panel">
        <h2>Transcript</h2><ol id="transcript" aria-live="polite"></ol>
        <h2>Events</h2><pre id="events" aria-live="polite"></pre>
      </aside>
    </main>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 4: Implement `web/src/styles.css`**

Provide a centered two-column stage, a rounded device shell, large readable type, visible focus rings, and `.sr-only`. Use CSS custom properties for theme. (Implementer: ~120 lines; no Tailwind.)

- [ ] **Step 5: Implement `web/src/main.ts`**

```ts
import { createAppHost } from "./host.js";

const screen = document.getElementById("screen") as HTMLElement;
const transcript = document.getElementById("transcript") as HTMLOListElement;
const events = document.getElementById("events") as HTMLPreElement;
const brain = document.getElementById("brain") as HTMLElement;
const utterance = document.getElementById("utterance") as HTMLInputElement;
const talk = document.getElementById("talk") as HTMLButtonElement;

const host = createAppHost({ mount: screen });

function addTurn(role: "user" | "assistant", text: string): void {
  const li = document.createElement("li");
  li.className = `turn turn--${role}`;
  li.textContent = text;
  transcript.append(li);
}

function speak(text: string): void {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  window.speechSynthesis.speak(u);
}

async function send(text: string): Promise<void> {
  if (!text.trim()) return;
  addTurn("user", text);
  try {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance: text })
    });
    if (!res.ok) throw new Error(`agent ${res.status}`);
    const data = (await res.json()) as { reply: string; brain: string; toolCalls: Array<{ name: string; input: Record<string, unknown> }> };
    brain.textContent = data.brain;
    addTurn("assistant", data.reply);
    speak(data.reply);
    events.textContent = JSON.stringify(data.toolCalls, null, 2);
    await host.handleToolCalls(data.toolCalls);
  } catch (err) {
    addTurn("assistant", "Something went wrong talking to the agent.");
    events.textContent = String(err);
  }
}

document.getElementById("type-form")!.addEventListener("submit", (e) => {
  e.preventDefault();
  const value = utterance.value;
  utterance.value = "";
  void send(value);
});

// Push-to-talk using the Web Speech API where available.
const SpeechRecognitionCtor = (window as unknown as { SpeechRecognition?: new () => never; webkitSpeechRecognition?: new () => never }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => never }).webkitSpeechRecognition;
if (SpeechRecognitionCtor) {
  const recognition = new SpeechRecognitionCtor() as unknown as {
    lang: string; interimResults: boolean; continuous: boolean;
    start(): void; stop(): void;
    onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  };
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.onresult = (e) => { void send(e.results[0]![0]!.transcript); };
  const start = () => { talk.setAttribute("aria-pressed", "true"); recognition.start(); };
  const stop = () => { talk.setAttribute("aria-pressed", "false"); recognition.stop(); };
  talk.addEventListener("pointerdown", start);
  talk.addEventListener("pointerup", stop);
  talk.addEventListener("pointerleave", stop);
} else {
  talk.disabled = true;
  talk.textContent = "Voice unavailable — use the text box";
}
```

- [ ] **Step 6: Verify the shell builds and serves**

Run: `npm run build:web`
Expected: `dist/web/index.html` is produced with no errors. Then, with the MCP server running (`npm start`) and `npm run dev:web` in another shell, opening `http://localhost:5173` shows the device frame; typing "what's due today?" returns a reply and populates Events. Confirm the `/api/agent` CORS/origin path works: the browser sends `Origin: http://localhost:5173`, which `isAllowedOrigin` allows.

- [ ] **Step 7: Commit**

```bash
git add web package.json package-lock.json
git commit -m "feat(web): add simulated Alexa+ client shell with voice and /api/agent"
```

---

### Task 4: MCP Apps host bridge, demo menu, and accessibility pass

**Files:**
- Create: `web/src/host.ts`
- Modify: `web/src/main.ts`, `web/index.html`, `web/src/styles.css`
- Create: `docs/demo-script.md`
- Test: `test/appHostContract.test.ts` (pure helper coverage)

**Interfaces:**
- Produces:
  - `createAppHost(deps: { mount: HTMLElement }): { handleToolCalls(calls: Array<{ name: string; input: Record<string, unknown> }>): Promise<void> }`.
  - `export function pickUiTool(calls: Array<{ name: string }>, uiTools: readonly string[]): { name: string } | undefined` (pure, tested).
- The host renders the View in a sandboxed iframe using `AppBridge` + `PostMessageTransport`, fetches the `ui://` resource via its MCP client, and pushes tool input/result into the View.

- [ ] **Step 1: Write the failing pure test** — create `test/appHostContract.test.ts`

`pickUiTool` must live in a dependency-free module (`web/src/uiTools.ts`) so this Node test does not import the browser bridge. `host.ts` imports it from there.

```ts
import { describe, it, expect } from "vitest";
import { pickUiTool } from "../web/src/uiTools.js";

describe("pickUiTool", () => {
  const ui = ["get_scan", "daily_briefing"] as const;
  it("returns the first call that has a UI", () => {
    expect(pickUiTool([{ name: "capture_scan" }, { name: "get_scan" }], ui)).toEqual({ name: "get_scan" });
  });
  it("returns undefined when no call has a UI", () => {
    expect(pickUiTool([{ name: "capture_scan" }], ui)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/appHostContract.test.ts`
Expected: FAIL — `web/src/uiTools.js` not found.

- [ ] **Step 3: Implement `web/src/uiTools.ts`**

```ts
export function pickUiTool(
  calls: Array<{ name: string }>,
  uiTools: readonly string[]
): { name: string } | undefined {
  return calls.find((c) => uiTools.includes(c.name));
}
```

- [ ] **Step 4: Implement `web/src/host.ts`**

Include the same `pickUiTool` re-exported from `./uiTools.js` for callers.

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AppBridge, PostMessageTransport, getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { pickUiTool } from "./uiTools.js";

export { pickUiTool };

export function createAppHost(deps: { mount: HTMLElement }) {
  const client = new Client({ name: "wayfinder-sim-host", version: "0.1.0" });
  let connected: Promise<void> | undefined;
  const ensure = () => {
    if (!connected) connected = client.connect(new StreamableHTTPClientTransport(new URL(`${location.origin}/mcp`)) as unknown as Transport);
    return connected;
  };

  let bridge: AppBridge | undefined;
  let iframe: HTMLIFrameElement | undefined;

  async function renderFor(name: string, input: Record<string, unknown>, result: unknown): Promise<void> {
    await ensure();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === name);
    const uri = tool ? getToolUiResourceUri(tool) : undefined;
    if (!uri) return;

    if (!iframe) {
      iframe = document.createElement("iframe");
      iframe.title = "Wayfinder view";
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.style.cssText = "width:100%;border:0;border-radius:12px;background:transparent;";
      deps.mount.replaceChildren(iframe);
      bridge = new AppBridge(client, { name: "wayfinder-sim-host", version: "0.1.0" }, { openLinks: {}, serverTools: {}, logging: {} });
      bridge.onsizechange = ({ height }) => { if (height != null && iframe) iframe.style.height = `${height}px`; };
      bridge.oninitialized = () => {
        void bridge!.sendToolInput({ arguments: input });
        void bridge!.sendToolResult({ content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result } as never);
      };
      await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
    } else if (bridge) {
      await bridge.sendToolInput({ arguments: input });
      await bridge.sendToolResult({ content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result } as never);
    }

    const read = await client.readResource({ uri });
    const html = (read.contents[0] as { text?: string }).text ?? "";
    iframe.srcdoc = html;
  }

  return {
    async handleToolCalls(calls: Array<{ name: string; input: Record<string, unknown> }>): Promise<void> {
      const uiCall = pickUiTool(calls, ["get_scan", "list_items", "get_item", "daily_briefing", "identify_product", "find_object"]);
      if (!uiCall) return;
      await ensure();
      const result = await client.callTool({ name: uiCall.name, arguments: uiCall.input });
      await renderFor(uiCall.name, uiCall.input, result.structuredContent);
    }
  };
}
```

Confirm the exact `McpUiToolResultNotification` `params` shape and `AppBridge`/`PostMessageTransport` constructor signatures against `node_modules/@modelcontextprotocol/ext-apps/dist/src/app-bridge.d.ts`; adjust the `sendToolResult` call to the declared type rather than casting.

- [ ] **Step 4: Add a demo menu and accessibility pass**

In `web/index.html`/`main.ts`, add a small demo menu with: a **Reset** action that calls a server endpoint or clears local state, quick-pick sample utterances ("read my mail", "what's due today?", "where are my keys?"), and a **large text** toggle that flips a `data-large-text` attribute on `<body>` and bumps the root font size. Ensure all controls are keyboard reachable with visible focus.

- [ ] **Step 5: Write `docs/demo-script.md`**

Document the three-minute beats: (1) "read my mail" → cards appear; (2) "what's due today?" → briefing; (3) "where are my keys?" → object memory; plus the fallback narration when Bedrock is unavailable. Include the exact spoken lines and which screen each produces.

- [ ] **Step 6: Gates and commit**

Run: `npx vitest run test/appHostContract.test.ts; if ($?) { npm run build:ui }; if ($?) { npm run build:web }; if ($?) { npm test }; if ($?) { npm run typecheck }; if ($?) { npm run lint }`
Also verify in a browser that a tool call with a UI renders an iframe whose content resizes to its content (the `onsizechange` path).

```bash
git add web/src/host.ts web/src/main.ts web/index.html web/src/styles.css docs/demo-script.md test/appHostContract.test.ts
git commit -m "feat(web): render MCP App views via the host bridge with demo menu"
```

---

## Self-Review

**Spec coverage (Plan 4 scope):** MCP Apps UI with screens for findings/inbox/detail/briefing/label/object (§12); simulated Alexa+ client with voice and camera-adjacent capture flow (§14); cross-modal consistency and voice-first rules (§16); accessibility basics (§5 EAA note). Camera capture for `assess`-style scanning is expressed through the rule brain's `demoImageRef` and the client's sample utterances; real device camera capture is not required by the spec's simulated path and is explicitly out of scope.

**Placeholder scan:** the plan intentionally points the implementer at the installed `@modelcontextprotocol/ext-apps` type declarations for the two View/host API surfaces I could not fully verify from published docs (`App` connect/transport, `sendToolResult` params). That is a read-the-shipped-types instruction with the vendor types present in `node_modules`, not a "fill in later" placeholder; every other step carries real code.

**Type consistency:** `APP_RESOURCE_URI`/`UI_TOOLS` are defined once in `appResource.ts` and imported by the server and both tests. `ScreenInput` is shared between `screens.ts` and `main.ts`. `pickUiTool` is exported from `host.ts` and tested. The client's UI-tool list is duplicated in `host.ts` — accepted because the browser bundle must not import server code; note it as a follow-up to derive from a shared constants module.

**Ordering:** T1 (bundle) precedes T2 (resource read callback needs `dist/ui/app.html`). T2 precedes T4 (the host reads the registered `ui://` resource and tool metadata). T3 (client shell) precedes T4 (host bridge mounts into the shell).

**Risk note:** the browser acting as a full MCP host is the one architectural risk; if `StreamableHTTPClientTransport` misbehaves in-browser, fall back to a thin server-side host that returns the already-rendered HTML for a call, keeping the same client UI. Record which path was taken in the plan's ledger.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-09-19-wayfinder-ui-client.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — execute in this session with checkpoints.

Which approach?
