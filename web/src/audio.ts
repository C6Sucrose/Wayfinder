import { cueFor, normalizeLevel, type CueName } from "./audioMath.js";

export { cueFor, historyPoints, normalizeLevel, smoothLevel } from "./audioMath.js";
export type { CueName } from "./audioMath.js";

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | undefined {
  const scope = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

let context: AudioContext | undefined;
let enabled = false;

export function setCuesEnabled(on: boolean): void {
  enabled = on;
  if (!on && context && context.state === "running") void context.suspend();
}

export function cuesEnabled(): boolean {
  return enabled;
}

export function playCue(name: CueName): void {
  if (!enabled) return;
  const Ctor = audioContextCtor();
  if (!Ctor) return;
  if (!context) context = new Ctor();
  void context.resume();
  const { hz, ms } = cueFor(name);
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = hz;
  const now = context.currentTime;
  const seconds = ms / 1000;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + seconds + 0.02);
}

export interface LevelMeter {
  stop(): void;
}

export function startLevelMeter(
  onLevel: (level: number) => void,
  onError?: (err: unknown) => void
): LevelMeter {
  let stopped = false;
  let raf = 0;
  let stream: MediaStream | undefined;
  let ownContext: AudioContext | undefined;

  const stop = (): void => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    stream?.getTracks().forEach((track) => track.stop());
    if (ownContext && ownContext.state !== "closed") void ownContext.close();
    ownContext = undefined;
  };

  void (async () => {
    try {
      const media = navigator.mediaDevices;
      if (!media?.getUserMedia) throw new Error("getUserMedia unavailable");
      stream = await media.getUserMedia({ audio: true });
      if (stopped) return;
      const Ctor = audioContextCtor();
      if (!Ctor) throw new Error("AudioContext unavailable");
      ownContext = new Ctor();
      const source = ownContext.createMediaStreamSource(stream);
      const analyser = ownContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buffer = new Uint8Array(analyser.fftSize);
      const tick = (): void => {
        if (stopped) return;
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (const sample of buffer) {
          const centred = (sample - 128) / 128;
          sum += centred * centred;
        }
        onLevel(normalizeLevel(Math.sqrt(sum / buffer.length) * 255 * 2));
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      if (!stopped) onError?.(err);
    }
  })();

  return { stop };
}
