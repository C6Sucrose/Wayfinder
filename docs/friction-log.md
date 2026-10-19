# Friction log

Chronological record of what slowed the build, with the resolution and the cost. Dates are the working days; times are approximate. "Cost" is the time lost, not the time to fix.

## 2026-09-19 — Project scaffolding

- **Cost: 2 h.** The original design assumed an Alexa+ add-on toolkit (Alexa AI CLI, web simulator, Local Inspector). It was in Private Preview and unavailable to us, so the simulated host had to be built from scratch. *Resolution:* a Vite host that speaks real MCP and renders MCP Apps. *Friction:* the platform decision had to be made before any code, and it shaped everything after.

## 2026-09-20 — MCP App resource and host

- **Cost: 1 h.** `McpUiHostCapabilities` could not be imported from either `@modelcontextprotocol/ext-apps` or `.../app-bridge` without `TS2460: declares locally but is exported as …`. *Resolution:* dropped the annotation and let inference type it.

## 2026-09-21 — Screens and the sandbox

- **Cost: 1 h.** Assumed the View could request the microphone for a level meter. The sandbox (`allow-scripts`, no same-origin) correctly forbids it. *Resolution:* all speech and audio moved into the host; the View stays presentation-only. *Lesson:* the sandbox is a design constraint, not an implementation detail.

## 2026-09-22 — Region and quota drift

- **Cost: 3 h.** The server defaulted to `eu-central-1` while the quota requests were filed in `us-east-1`. An approval would have been invisible to the default configuration. *Resolution:* standardised on `us-east-1` in code and docs.

## 2026-09-23 — Bedrock quota investigation

- **Cost: 6 h over two days.** Requested two cross-region TPM quotas (6M each). One was closed as "no further action required"; the other stayed open under "active review". Effective values remained `0`. *Friction:* no API for account-verification state; `DescribeCases` requires Premium Support; the two replies contradicted each other.
- **Cost: 2 h.** Discovered the real gate is the per-model **daily** token quota, not TPM. Every candidate model returned `ThrottlingException: Too many tokens per day`, and the same quota read `0` in one region, hundreds of millions in two others, and "account is currently being verified" in a fourth.

## 2026-10-05 — Reaching for an alternative reader

- **Cost: 2 h.** Evaluated a "System One" decision model (NanoJev) as an OCR/abstention signal. It is a game-trained 0.6B choice model and returns typed probabilities, not text — not an OCR engine, and unsuitable for the deterministic authority path. *Resolution:* rejected with a written rationale; Textract chosen instead.

## 2026-10-06 — Textract and Rekognition probes

- **Cost: 1 h.** The first probes failed with `InvalidImageFormatException` / `UnsupportedDocumentException` because the test image was a 1×1 PNG. *Resolution:* generated a valid PNG; both services then worked (Textract `PAGE` block, Rekognition labels).

## 2026-10-12 — Documentation build

- **Cost: 1 h.** A Mermaid flowchart's node labels were clipped in the renderer. Switching `htmlLabels: false` did not fix it. *Resolution:* replaced Mermaid with hand-authored SVG figures.
- **Cost: 45 min.** The replacement SVG used `&middot;`, an HTML entity that is invalid in XML; the image broke. *Resolution:* numeric reference `&#183;`, plus a test that rejects undefined entities.
- **Cost: 30 min.** A checker run under reduced motion reported "orb states not visually distinct" — a false positive, because reduced motion correctly disables all animation. *Lesson:* verification scripts need to model the mode they run in.

## 2026-10-13 — Accessible UI pass

- **Cost: 1 h.** Empty states shipped with no heading, and the verification Copy button was 21 px tall. Both were caught by a headless browser measurement, not by unit tests. *Resolution:* empty states wrapped in a labelled screen; 48 px minimum enforced.

## 2026-10-14 — Voice and motion

- **Cost: 2 h.** `SpeechRecognition` and `getUserMedia` are separate captures; running both is fragile. *Resolution:* a guard so a recognition failure still leaves a live level meter.
- **Cost: 45 min.** Push-to-talk could submit the same utterance twice (final result plus `stop()`). *Resolution:* a single `sentFinal` guard with cleared transcript.

## 2026-10-17 — Provider layer

- **Cost: 2 h.** `PRESETS[id]` prototype-key lookups (`constructor`, `__proto__`) bypassed the unknown-provider fallback and crashed startup; empty-string env vars shadowed presets; an empty Azure base URL threw inside `new URL()`. *Resolution:* `Object.hasOwn`, `nonEmpty` normalization, and URL validation with fallback.
- **Cost: 1 h.** `exactOptionalPropertyTypes` forced conditional spreads throughout the provider layer; correct, but repeated.
- **Cost: 1 h.** AWS CLI sessions expired three times in one day, each requiring re-login before any quota or Bedrock call.

## Recurring friction

| Item | Occurrences | Cost |
|---|---|---|
| AWS session expiry | 3+ | ~1 h total |
| Windows CRLF warnings masking real warnings | every commit | small, constant |
| WSL `bash` unusable for scripts | 1 | switched to Git Bash |
| Quota error messages not naming the quota | every probe | ~2 h cumulative |

## What we would do first next time

1. Verify model access with one tiny call per region **before** designing around a model.
2. Read the per-model **daily** quota, not only tokens per minute.
3. Decide the voice capture boundary (host vs sandboxed View) before writing any UI.
4. Measure accessibility (targets, contrast, headings) in a real browser from the first screen.
5. Keep the model behind a port from day one — a quota wall then costs a config change, not a rewrite.
