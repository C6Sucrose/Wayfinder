# Web platform feedback

Browser APIs used: `getUserMedia` + `AudioContext`/`AnalyserNode`, `SpeechRecognition` (vendor-prefixed), `speechSynthesis`, `ResizeObserver`, `IntersectionObserver`, `matchMedia`.

**Severity: High** for the speech + microphone combination.

## What worked

- **`getUserMedia` + `AnalyserNode`** gives a genuine real-time level: RMS over `getByteTimeDomainData`, suitable for a reactive voice indicator. Permission prompts and device selection behaved predictably on `localhost` (HTTPS required in production).
- **`speechSynthesis`** works well enough for the demo, including `onend` to return the UI to idle.
- **`ResizeObserver` / `IntersectionObserver` / `matchMedia`** are reliable and made layout, scroll-spy, and reduced-motion detection straightforward.

## What was hard

1. **Speech recognition and level metering are two different microphones.** `SpeechRecognition` does not expose the audio stream it is consuming, so a live level meter requires a **second** `getUserMedia` capture. Running both at once works in Chrome but is fragile: device contention, double permission prompts, and echo are all real risks. There is no supported API to analyse the audio that recognition is already using.
2. **`SpeechRecognition` is not standardised.** It is vendor-prefixed (`webkitSpeechRecognition`), absent in some browsers, and differs in interim-result behaviour. We had to feature-detect and degrade.
3. **`AudioContext` autoplay policy.** A context created without a user gesture starts suspended; our cue player must call `resume()` on the first interaction. This is documented but easy to miss, and it fails silently.
4. **`speechSynthesis.onend` is unreliable across platforms** (it can fire late, twice, or not at all when the tab is backgrounded), so the UI state machine needs a timeout fallback in addition to the event.
5. **No unified permission story.** Microphone permission for `getUserMedia` and for `SpeechRecognition` are surfaced differently, so "the mic isn't working" has several possible causes.

## Suggestions

- Standardise a way to observe the audio stream behind speech recognition, or document the two-capture pattern prominently.
- Ship a tiny "mic level" primitive (or a reference implementation) so every voice app does not re-derive RMS smoothing and peak decay.
- Make `SpeechRecognition` standards-track, or at least specify interim/final semantics precisely.
- Document the `AudioContext` unlock requirement next to `speechSynthesis` examples.
- Consider a permissions API that reports which microphone capabilities are granted, per origin.

## What we did

- The host owns both: a `getUserMedia` meter for the orb and `SpeechRecognition` for text, with a guard so a recognition failure still leaves a live level.
- Cues are opt-in and resume the audio context on a gesture.
- Reduced motion is honoured through `matchMedia`.
