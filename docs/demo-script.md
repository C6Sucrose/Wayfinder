# Wayfinder three-minute demo script

Wayfinder is a voice-first MCP server that renders interactive MCP App views in a
simulated Alexa+ client. This script is the exact 3-minute walkthrough: the lines
to say, and what appears on the device screen.

## Before you start

1. `npm install`
2. Terminal A: `npm run build` then `npm start` (server on `http://127.0.0.1:8080`)
3. Terminal B: `npm run dev:web` then open `http://127.0.0.1:5173`

The rule brain needs nothing: it is the default and produces no warnings. To use a
hosted brain, set `WAYFINDER_PROVIDER` (for example `google`) plus that provider's
key env (for example `GEMINI_API_KEY`) and `WAYFINDER_MODEL` before `npm start`;
the provider table in the README lists every preset and its key env. Vision uses
`WAYFINDER_VISION=textract` with AWS credentials and `AWS_REGION`; provider vision
is not implemented in this release.

With no hosted provider and no `BEDROCK_MODEL_ID` configured, the badge shows
`rules` and the fallback lines below apply (Section: Fallback).

Setup line (say it first, so the object-memory beat has something to find):

> "Remember my keys are on the kitchen counter."

- Captured: `brain: rules`, `reply: "Saved keys."`,
  `toolCalls: [{"name":"remember_object","input":{"name":"keys","locationNote":"the kitchen counter"}}]`

## Beat 1 (0:30–1:10) — "read my mail" → cards

Say:

> "Read my mail."

- Screen: the device screen fills with the results card grid from `get_scan`:
  one card per mail item, showing its class and due date when present.
- This is the hosted-brain path (the captured run used Bedrock: `brain: bedrock`):
  the brain calls `capture_scan` and then `get_scan`, which is the tool that carries
  `_meta.ui.resourceUri`, so the host mounts the View.
- Not captured for this script: the exact hosted-brain reply/tool sequence depends
  on the configured provider. With document vision configured the spoken line is
  the server's `get_scan` summary, e.g. "I read N item(s)."

### Fallback when no hosted brain is configured (`brain: rules`)

The rule brain routes "read my mail" straight to `capture_scan`, and vision is not
configured, so no cards appear. Captured exactly:

- `brain: rules`
- `reply: "I can't read photos on this device yet — that part isn't set up."`
- `toolCalls: [{"name":"capture_scan","input":{"imageRefs":["demo"],"hint":"mail"}}]`
- Screen: unchanged (no `get_scan` call, so no UI-resource tool runs).

Narrate: "In this offline configuration the reader isn't set up, so there are no
cards yet. With document vision enabled through Amazon Textract, this is where the
mail cards appear."

## Beat 2 (1:10–1:50) — "what's due today?" → briefing

Say:

> "What's due today?"

- Captured: `brain: rules`, `reply: "Nothing needs your attention today."`,
  `toolCalls: [{"name":"daily_briefing","input":{}}]`
- Screen: the briefing grid — three cards, `Due`, `Appointments`, and `Flagged`.
  With an empty store the captured run shows `0 / 0 / 0`; with items in the store
  the same cards show the real counts, and a flagged card turns red.

## Beat 3 (1:50–2:30) — "where are my keys?" → object memory

Say (after the setup line from "Before you start"):

> "Where are my keys?"

- Captured: `brain: rules`, `reply: "Last seen the kitchen counter."`,
  `toolCalls: [{"name":"find_object","input":{"name":"keys"}}]`
- Screen: the object-memory card titled `keys`, with the line
  "Last seen the kitchen counter".

If the setup line was skipped, the captured reply is
`"I don't have a location for keys."` and the screen shows the empty state
"I don't have a location for that."

## Wrap (2:30–3:00)

- Call out the shell: transcript on the right, and the Events panel showing the
  raw `toolCalls` the agent made.
- Show the **Large text** toggle (the `data-large-text` attribute on `<body>`)
  and the **Reset** button (client-local: clears transcript, events, brain badge,
  and screen).
- Call out the plumbing: the client is an MCP host; the view is served from the
  `ui://wayfinder/app.html` resource and rendered in a sandboxed iframe through
  the MCP Apps `AppBridge`, so the same view works in any MCP Apps host.

## Fallback narration when no hosted brain is configured

The brain badge reads `rules`. The server is fully runnable with no AWS account;
the rule-based brain routes each utterance to one tool call.

Say:

> "This demo is running the offline rule brain — the badge says 'rules'. It routes
> your request to the right tool and speaks the tool's answer. With a hosted provider
> configured, the same tools get a natural-language brain, and Textract can read the
> photos behind the mail cards in beat one."

Captured fallback lines (reproduced above, in order):

1. "read my mail" → "I can't read photos on this device yet — that part isn't set up."
2. "what's due today?" → "Nothing needs your attention today."
3. "where are my keys?" → "I don't have a location for keys."
   (or "Last seen the kitchen counter." after the setup line)

## Accessibility notes for the presenter

- Every control (quick-pick cards, Large text, Reset, Hold to talk, Send) is a
  native button or input: keyboard reachable, visible `:focus-visible` outline,
  and at least 48px tall.
- The large-text toggle is `aria-pressed`-synchronized and scales the root font
  size as well as the body copy.
- The transcript and brain badge are `aria-live` regions, so the spoken replies
  are also announced when driven by the talk or quick-pick buttons.

---

## Recording the three-minute video

This is the runbook for the submitted video. The script above is the spoken
content; this section is the production plan.

### Pre-record checklist

1. **Decide the honest configuration.** Either:
   - offline only (rule brain, no vision) — always works; or
   - rule brain + `WAYFINDER_VISION=textract` with AWS credentials — gives real
     document reading on camera.
   Do **not** record claiming a hosted brain unless `WAYFINDER_PROVIDER` is set
   and `/capabilities` confirms it.
2. Build and start clean:
   ```bash
   npm run build
   npm start
   ```
   Remove any previous data directory so counts are predictable.
3. Start the host: `npm run dev:web`, open `http://127.0.0.1:5173`.
4. Check `http://127.0.0.1:8080/capabilities` and note the exact `brain` and
   `vision` values. Those are what you may say on camera.
5. Grant microphone permission, and confirm the orb reacts to your voice before
   recording (the gain bar should move).
6. Browser: hide bookmarks bar, close other tabs and notifications, 100% zoom.
7. Capture at 1920×1080, 30 fps, system audio on, cursor visible but still.
8. Do one silent dry run of the click path, then record in one take.
9. Add English captions after recording; the submission requires English.

### Timing budget (180 s total)

| Time | Beat | On screen |
|---|---|---|
| 0:00–0:15 | Thesis, one sentence | Orb idle, breathing |
| 0:15–0:40 | "Read my mail" | Pipeline lights Capture → Correlate; ticker; document cards |
| 0:40–1:05 | "What do I need to deal with?" | Backlog threads, urgency meters, reminder counts |
| 1:05–1:30 | Refusal | Refusal card, reason, escalate button |
| 1:30–1:55 | "Prove it" | Verification screen, chain seals, terminal hash, Copy |
| 1:55–2:20 | "Where are my keys?" | Object memory card |
| 2:20–2:45 | Accessibility | Larger text, dark theme, Motion off, keyboard focus |
| 2:45–3:00 | Honest close | Ledger + "recorded confirmation" wording |

### Shot list with exact lines

**0:00 — Opening (15 s).** No clicks. Say:

> "Sighted people check their post by glancing at it. A blind person can't — and when
> they say what a letter claimed, they're often disbelieved. Wayfinder is built for
> that gap: it reads the paperwork, acts only within limits you set, and can prove
> what it did."

**0:15 — Read (25 s).** Say "Remember my keys are on the kitchen counter." first if
you want the object beat later. Then say:

> "Read my mail."

Watch the pipeline: Capture lights, then Correlate. Point at the cards.

> "Each document becomes a card: who it's from, what's owed, when. Low-confidence
> reads are marked, not guessed at."

**0:40 — Triage (25 s).** Click **Backlog**. Say:

> "What do I need to deal with?"

> "Threads, ranked by urgency. This one is a third reminder, and it shows the
> deadline — not a bare count."

**1:05 — Refusal (25 s).** Click a proposed action that the envelope forbids (for
example discard). The refusal card appears. Say:

> "I'm not allowed to do that, and it says so — with the reason — and offers to ask
> my trusted contact instead. Nothing was changed, and the refusal is in the record."

**1:30 — Proof (25 s).** Say:

> "Prove it."

The verification screen appears; the chain blocks light and the seal lands. Click
**Copy** once to show the fingerprint is real, then say:

> "The whole record is hash-chained. This screen recomputes it. If a single entry had
> been altered, it would show the first broken link — and it doesn't."

**1:55 — Object memory (25 s).** Say:

> "Where are my keys?"

> "Last seen on the kitchen counter."

**2:20 — Accessibility (25 s).** Toggle **Larger text**, then **Dark**, then
**Motion** off. Tab once to show the focus ring. Say:

> "Everything you just saw is also spoken. Text scales, contrast holds, motion can be
> switched off entirely, and every control is reachable from the keyboard."

**2:45 — Close (15 s).**

> "The record is internally consistent and tamper-evident. It proves what the system
> saw and did — not that a bank confirmed it. That honesty is the product."

### What not to claim on camera

- Do **not** say Bedrock is running. It is gated by AWS account verification.
- Do **not** say `WAYFINDER_VISION=provider` works; it is not implemented.
- Do **not** describe confirmation as bank-verified or legally binding.
- Do **not** imply the client is a real Alexa device; call it an MCP host.
- Do **not** claim payment execution. The handoff prepares an instruction and a QR
  code for the user's own banking app.

### If something goes wrong mid-take

- **No cards after "read my mail":** vision is not configured. Keep going and narrate
  the Textract path honestly, or restart with `WAYFINDER_VISION=textract`.
- **Brain badge reads `bedrock` unexpectedly:** stop; `BEDROCK_MODEL_ID` is set.
  Unset it for a deterministic take.
- **Orb does not move:** microphone permission was denied. The demo still works; say
  "the level indicator needs microphone permission" and continue typing.
- **A provider error appears:** the reply is a generic failure line; re-run the beat.
  Do not attempt to explain a stack trace on camera.

