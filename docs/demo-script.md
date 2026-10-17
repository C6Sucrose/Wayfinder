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

Without a hosted brain the badge shows `rules` and the fallback lines below apply
(Section: Fallback).

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
