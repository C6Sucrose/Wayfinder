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

// Demo menu: quick-pick utterances, a client-local Reset, and a large-text toggle.
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-utterance]")) {
  button.addEventListener("click", () => void send(button.dataset.utterance ?? ""));
}

const largeText = document.getElementById("large-text") as HTMLButtonElement;
function setLargeText(on: boolean): void {
  if (on) document.body.setAttribute("data-large-text", "");
  else document.body.removeAttribute("data-large-text");
  largeText.setAttribute("aria-pressed", String(on));
}
largeText.addEventListener("click", () => setLargeText(largeText.getAttribute("aria-pressed") !== "true"));

const resetButton = document.getElementById("reset") as HTMLButtonElement;
resetButton.addEventListener("click", () => {
  transcript.replaceChildren();
  events.textContent = "";
  brain.textContent = "rules";
  screen.replaceChildren();
  utterance.value = "";
});

// Push-to-talk using the Web Speech API where available.
const SpeechRecognitionCtor = (window as unknown as { SpeechRecognition?: new () => never; webkitSpeechRecognition?: new () => never }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => never }).webkitSpeechRecognition;
if (SpeechRecognitionCtor) {
  const recognition = new SpeechRecognitionCtor() as unknown as {
    lang: string; interimResults: boolean; continuous: boolean;
    start(): void; stop(): void;
    onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
    onend: () => void; onerror: () => void;
  };
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.onresult = (e) => { void send(e.results[0]![0]!.transcript); };
  let listening = false;
  const reset = () => { listening = false; talk.setAttribute("aria-pressed", "false"); };
  recognition.onend = reset;
  recognition.onerror = reset;
  const start = () => {
    if (listening) return;
    listening = true;
    talk.setAttribute("aria-pressed", "true");
    try { recognition.start(); } catch { reset(); }
  };
  const stop = () => {
    if (!listening) return;
    reset();
    try { recognition.stop(); } catch { reset(); }
  };
  talk.addEventListener("pointerdown", start);
  talk.addEventListener("pointerup", stop);
  talk.addEventListener("pointerleave", stop);
} else {
  talk.disabled = true;
  talk.textContent = "Voice unavailable — use the text box";
}
