import { createAppHost, type Appearance } from "./host.js";
import { historyPoints, playCue, setCuesEnabled, smoothLevel, startLevelMeter, type LevelMeter } from "./audio.js";
import { pipelineState, revealSteps, stagesFor, type StageId } from "./pipeline.js";

const screen = document.getElementById("screen") as HTMLElement;
const transcript = document.getElementById("transcript") as HTMLOListElement;
const events = document.getElementById("events") as HTMLPreElement;
const brain = document.getElementById("brain") as HTMLElement;
const utterance = document.getElementById("utterance") as HTMLInputElement;
const talk = document.getElementById("talk") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLElement;
const orb = document.getElementById("orb") as HTMLElement;
const voiceState = document.getElementById("voice-state") as HTMLElement;
const heard = document.getElementById("heard") as HTMLElement;
const gainFill = document.getElementById("gain-fill") as HTMLElement;
const gainPeak = document.getElementById("gain-peak") as HTMLElement;
const sparkLine = document.getElementById("spark-line") as unknown as SVGPolylineElement;
const ticker = document.getElementById("ticker") as HTMLOListElement;
const pipelineEls = Array.from(document.querySelectorAll<HTMLElement>(".pipeline__stage"));
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".tab"));

const appearance: Appearance = { theme: "light", textSize: "normal" };
const host = createAppHost({ mount: screen, appearance });

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const prefersReducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function setStatus(text: string): void {
  status.textContent = text;
}

function setVoiceState(next: "idle" | "listening" | "thinking" | "speaking", label: string): void {
  orb.dataset.state = next;
  voiceState.textContent = label;
}

function addTurn(role: "user" | "assistant", text: string): HTMLLIElement {
  const li = document.createElement("li");
  li.className = `turn turn--${role}`;
  li.textContent = text;
  transcript.append(li);
  transcript.scrollTop = transcript.scrollHeight;
  return li;
}

function speak(text: string, onDone: () => void): void {
  if (!("speechSynthesis" in window) || !text) {
    onDone();
    return;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.onend = onDone;
  u.onerror = onDone;
  window.speechSynthesis.speak(u);
}

async function reveal(node: HTMLElement, text: string): Promise<void> {
  if (prefersReducedMotion()) {
    node.textContent = text;
    return;
  }
  const steps = revealSteps(text, 3);
  for (const step of steps) {
    node.textContent = step;
    await wait(18);
  }
}

function setActiveTab(view: string): void {
  for (const tab of tabs) tab.setAttribute("aria-pressed", String(tab.dataset.view === view));
}

/* ---------- Pipeline ---------- */

function applyPipeline(active?: StageId): void {
  for (const state of pipelineState(active)) {
    const el = pipelineEls.find((candidate) => candidate.dataset.stage === state.id);
    if (el) el.dataset.status = state.status;
  }
}

function completePipeline(): void {
  for (const el of pipelineEls) el.dataset.status = "done";
}

function resetPipeline(): void {
  for (const el of pipelineEls) el.dataset.status = "pending";
}

function addTicker(name: string, input: Record<string, unknown>): void {
  const li = document.createElement("li");
  const code = document.createElement("code");
  code.textContent = name;
  li.append(code);
  const detail = Object.entries(input).find(([, value]) => typeof value === "string");
  if (detail) li.append(document.createTextNode(String(detail[1])));
  ticker.append(li);
}

async function runPipeline(calls: Array<{ name: string; input: Record<string, unknown> }>): Promise<void> {
  ticker.replaceChildren();
  const stages = stagesFor(calls);
  if (!stages.length) return;
  for (const stage of stages) {
    applyPipeline(stage);
    for (const call of calls.filter((c) => stagesFor([c])[0] === stage)) addTicker(call.name, call.input);
    await wait(prefersReducedMotion() ? 40 : 320);
  }
  completePipeline();
}

/* ---------- Microphone level ---------- */

let meter: LevelMeter | undefined;
let level = 0;
let peak = 0;
const history: number[] = [];

function renderMeter(): void {
  orb.style.setProperty("--level", level.toFixed(3));
  gainFill.style.width = `${(level * 100).toFixed(1)}%`;
  gainPeak.style.left = `${(peak * 100).toFixed(1)}%`;
  if (history.length > 1) {
    sparkLine.setAttribute("points", historyPoints(history, 24, 100).map((p) => `${p.x},${p.y}`).join(" "));
  }
}

function beginMetering(): void {
  if (meter) return;
  history.length = 0;
  meter = startLevelMeter(
    (next) => {
      level = smoothLevel(level, next);
      peak = Math.max(peak * 0.97, level);
      history.push(level);
      if (history.length > 60) history.shift();
      renderMeter();
    },
    () => {
      setStatus("Microphone unavailable — voice input may not work, but typing still does.");
    }
  );
}

function endMetering(): void {
  meter?.stop();
  meter = undefined;
  level = 0;
  peak = 0;
  renderMeter();
}

/* ---------- Requests ---------- */

async function send(text: string): Promise<void> {
  if (!text.trim()) return;
  addTurn("user", text);
  setStatus("Working…");
  setVoiceState("thinking", "Thinking about that…");
  playCue("listen-stop");
  transcript.scrollTop = transcript.scrollHeight;
  try {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ utterance: text })
    });
    if (!res.ok) throw new Error(`agent ${res.status}`);
    const data = (await res.json()) as {
      reply: string;
      brain: string;
      toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
    };
    brain.textContent = data.brain;
    events.textContent = JSON.stringify(data.toolCalls, null, 2);
    await runPipeline(data.toolCalls);
    setStatus(data.reply);
    const bubble = addTurn("assistant", "");
    setVoiceState("speaking", data.reply);
    await reveal(bubble, data.reply);
    speak(data.reply, () => setVoiceState("idle", "Ready — hold to talk or type"));
    if (!("speechSynthesis" in window)) setVoiceState("idle", "Ready — hold to talk or type");
    playCue("recorded");
    await host.handleToolCalls(data.toolCalls);
    window.setTimeout(() => resetPipeline(), 1600);
  } catch (err) {
    addTurn("assistant", "Something went wrong talking to the agent.");
    setStatus("Something went wrong talking to the agent.");
    events.textContent = String(err);
    setVoiceState("idle", "Ready — hold to talk or type");
  }
}

document.getElementById("type-form")!.addEventListener("submit", (e) => {
  e.preventDefault();
  const value = utterance.value;
  utterance.value = "";
  void send(value);
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-utterance]")) {
  button.addEventListener("click", () => void send(button.dataset.utterance ?? ""));
}

// Views run tools directly so navigation does not need the language model.
for (const tab of tabs) {
  tab.addEventListener("click", () => {
    const tool = tab.dataset.tool;
    if (!tool) return;
    setActiveTab(tab.dataset.view ?? "");
    const input = tool === "list_items" ? { filter: "all" } : {};
    setStatus("Showing…");
    void host
      .invoke(tool, input)
      .then(() => setStatus(""))
      .catch(() => setStatus("I couldn't load that view."));
  });
}

/* ---------- Appearance and sound ---------- */

const themeButton = document.getElementById("theme") as HTMLButtonElement;
function setTheme(theme: Appearance["theme"]): void {
  appearance.theme = theme;
  document.documentElement.dataset.theme = theme;
  themeButton.setAttribute("aria-pressed", String(theme === "dark"));
  themeButton.textContent = theme === "dark" ? "Light" : "Dark";
  host.setAppearance({ theme });
}
themeButton.addEventListener("click", () => setTheme(appearance.theme === "dark" ? "light" : "dark"));

const largeText = document.getElementById("large-text") as HTMLButtonElement;
function setLargeText(on: boolean): void {
  appearance.textSize = on ? "large" : "normal";
  if (on) document.body.setAttribute("data-large-text", "");
  else document.body.removeAttribute("data-large-text");
  largeText.setAttribute("aria-pressed", String(on));
  host.setAppearance({ textSize: appearance.textSize });
}
largeText.addEventListener("click", () => setLargeText(largeText.getAttribute("aria-pressed") !== "true"));

const motionButton = document.getElementById("motion") as HTMLButtonElement;
function setMotion(on: boolean): void {
  if (on) document.documentElement.removeAttribute("data-motion");
  else document.documentElement.setAttribute("data-motion", "off");
  motionButton.setAttribute("aria-pressed", String(on));
}
motionButton.addEventListener("click", () => setMotion(motionButton.getAttribute("aria-pressed") !== "true"));

const soundButton = document.getElementById("sound") as HTMLButtonElement;
function setSound(on: boolean): void {
  setCuesEnabled(on);
  soundButton.setAttribute("aria-pressed", String(on));
}
soundButton.addEventListener("click", () => setSound(soundButton.getAttribute("aria-pressed") !== "true"));

const resetButton = document.getElementById("reset") as HTMLButtonElement;
resetButton.addEventListener("click", () => {
  host.reset();
  transcript.replaceChildren();
  ticker.replaceChildren();
  events.textContent = "";
  brain.textContent = "";
  screen.replaceChildren();
  utterance.value = "";
  heard.textContent = "";
  setStatus("");
  setActiveTab("today");
  resetPipeline();
  setVoiceState("idle", "Ready — hold to talk or type");
});

/* ---------- Push-to-talk ---------- */

const SpeechRecognitionCtor =
  (window as unknown as { SpeechRecognition?: new () => never; webkitSpeechRecognition?: new () => never }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: new () => never }).webkitSpeechRecognition;

if (SpeechRecognitionCtor) {
  const recognition = new SpeechRecognitionCtor() as unknown as {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    start(): void;
    stop(): void;
    onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
    onend: () => void;
    onerror: () => void;
  };
  recognition.lang = "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;
  let sentFinal = false;
  recognition.onresult = (e) => {
    let final = "";
    let interim = "";
    for (let i = 0; i < e.results.length; i += 1) {
      const result = e.results[i]!;
      const text = result[0]?.transcript ?? "";
      if (result.length > 1 || (result as unknown as { isFinal?: boolean }).isFinal) final += text;
      else interim += text;
    }
    const finalText = final.trim();
    if (finalText && !sentFinal) {
      sentFinal = true;
      heard.textContent = finalText;
      void send(finalText);
      heard.textContent = "";
    } else if (!sentFinal) {
      heard.textContent = final || interim;
    }
  };
  let listening = false;
  const resetTalk = (): void => {
    listening = false;
    talk.setAttribute("aria-pressed", "false");
    endMetering();
    setVoiceState("idle", "Ready — hold to talk or type");
  };
  recognition.onend = resetTalk;
  recognition.onerror = resetTalk;
  const start = (): void => {
    if (listening) return;
    listening = true;
    sentFinal = false;
    talk.setAttribute("aria-pressed", "true");
    heard.textContent = "";
    setStatus("Listening…");
    setVoiceState("listening", "Listening — speak now");
    playCue("listen-start");
    beginMetering();
    try {
      recognition.start();
    } catch {
      resetTalk();
    }
  };
  const stop = (): void => {
    if (!listening) return;
    const heardNow = (heard.textContent ?? "").trim();
    resetTalk();
    try {
      recognition.stop();
    } catch {
      resetTalk();
    }
    if (sentFinal) {
      heard.textContent = "";
    } else if (heardNow) {
      sentFinal = true;
      heard.textContent = "";
      void send(heardNow);
    }
  };
  talk.addEventListener("pointerdown", start);
  talk.addEventListener("pointerup", stop);
  talk.addEventListener("pointerleave", stop);
  // Only keyboard-synthesized clicks toggle; pointer clicks are handled above.
  talk.addEventListener("click", (event) => {
    if (event.detail !== 0) return;
    if (listening) stop();
    else start();
  });
} else {
  talk.disabled = true;
  talk.textContent = "Voice unavailable — use the text box";
}

/* ---------- Boot ---------- */

setActiveTab("today");
setMotion(true);
setSound(false);
renderMeter();
void host.invoke("daily_briefing", {}).catch(() => setStatus("Start the server to load your day."));
