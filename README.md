# Wayfinder

**Verifiable agency for the paperwork you can't glance at.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](package.json)
[![Tests](https://img.shields.io/badge/tests-385%20passing-success.svg)](#development)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6.svg)](tsconfig.json)
[![MCP](https://img.shields.io/badge/MCP-server-6b4fbb.svg)](https://modelcontextprotocol.io)

Wayfinder is a voice-first **MCP server** that remembers the documents a blind or low-vision person cannot glance at, correlates them into threads, tracks what is still owed and at risk, acts only within limits the user sets, and keeps a tamper-evident record it can use to **prove what it did**.

It renders interactive **MCP App** screens into any MCP Apps host (the bundled client simulates an Alexa+ style device), and it runs fully offline: with no cloud credentials it still works, using a deterministic rule-based brain.

<!-- TOC -->
- [Why](#why)
- [What it does](#what-it-does)
- [Who it is for](#who-it-is-for)
- [Quick start](#quick-start)
- [Using it](#using-it)
- [MCP surface](#mcp-surface)
- [The record](#the-record)
- [Accessibility](#accessibility)
- [Safety and privacy](#safety-and-privacy)
- [Optional integrations](#optional-integrations)
- [Project layout](#project-layout)
- [Development](#development)
- [Documentation](#documentation)
- [License](#license)

## Why

Sighted people verify state by looking. A blind person cannot, and is disproportionately targeted by fraud and routinely disbelieved when they assert what a document said. Access to information is not the hard problem — **auditable, bounded, accountable agency** is.

Perception (reading a letter, a bill, a label) is an *input*. The product is the durable, verifiable handler for the paperwork a person cannot glance at. Three ideas carry it:

- **Calibrated abstention** — it refuses to act on a document it is not confident it read, rather than guessing on a payment amount or an account number.
- **A bounded envelope** — every action is checked against limits the user sets, before anything changes.
- **A verifiable ledger** — every decision gets a receipt, in an append-only, hash-chained log the user can export and verify.

## What it does

- **Captures** a photo or upload and reads it into a structured document (sender, amount, due date, reference, account tail).
- **Correlates** documents into threads: reminders raise urgency, a correction supersedes the older letter, and duplicates collapse into one demand.
- **Ranks what matters** by deadline risk and reminder count, not a bare list.
- **Acts within your limits** — remind, schedule, flag, file, discard, or share with a trusted contact — asking first above the amount you set, and refusing what you forbade.
- **Records everything** in a hash-chained ledger, and proves the record has not been altered.
- **Hands off payments safely** — it prepares a spoken instruction and a scannable SEPA QR code for you to complete **in your own banking app**. It never moves money.
- **Speaks and shows**: results are voiced, and matched by accessible interactive cards on screen (backlog, audit history, verification badge, refusal card).

### How a request flows

```mermaid
flowchart LR
  U[Voice or text] --> HOST[Host client]
  HOST -->|MCP tools| BRAIN[Agent brain]
  BRAIN --> SERVER[Wayfinder MCP server]
  SERVER --> DOMAIN[Domain: correlate, authority, ledger]
  DOMAIN --> STORE[(Local store)]
  SERVER -->|MCP resources| HOST
  SERVER -. off the request path .-> ADAPTERS[Optional adapters]
  HOST --> VIEW[Sandboxed MCP App view]
```

## Who it is for

- **Blind and low-vision users** who want their post, bills, and letters handled with proof of what happened.
- **Caregivers and trusted contacts** who step in when something is unresolved.
- **Tinkerers and operators** who want to point the core at their own notification channel, calendar folder, or payment handoff.

## Quick start

**Prerequisites:** Node.js 22 or newer. No AWS account is required to run.

```bash
npm install
npm run build      # bundles the MCP App view, then compiles TypeScript
npm start          # MCP server on http://127.0.0.1:8080
```

In a second terminal, run the demo client (it proxies `/api` and `/mcp` to the server):

```bash
npm run dev:web    # open http://127.0.0.1:5173
```

Try these utterances in the client:

- "Read my mail."
- "What's due today?"
- "Where are my keys?" (say "Remember my keys are on the kitchen counter." first)
- "What do I need to deal with?"
- "Prove it." — runs `verify_ledger` and reports the terminal hash

A full three-minute walkthrough, including the offline fallback narration, is in [`docs/demo-script.md`](docs/demo-script.md).

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | Server port |
| `WAYFINDER_DATA_DIR` | `data` | Where items, objects, preferences, and the ledger are stored |
| `WAYFINDER_CAPTURE_ROOT` | `WAYFINDER_DATA_DIR` | Root the image reader is allowed to read from |
| `ALLOWED_ORIGINS` | *(empty)* | Comma-separated origins accepted for `/mcp` and `/api/agent` |
| `BEDROCK_MODEL_ID` | *(unset)* | Enables the Amazon Bedrock brain and image reader |
| `AWS_REGION` | `eu-central-1` | Region for Bedrock |

Without `BEDROCK_MODEL_ID` the server uses a deterministic **rule brain** that routes each utterance to one tool call, and the reader reports itself unavailable. Everything else — correlation, authority, the ledger, and every screen — works offline.

## Using it

1. **Capture** — the agent calls `capture_scan` with image references; the reader produces document records with confidence and demands.
2. **Review** — `get_backlog` and `daily_briefing` rank open threads by urgency; the backlog screen shows sender, demand, deadline, and reminder count.
3. **Ask why** — `get_audit` explains what happened to a document or thread, straight from the ledger.
4. **Act** — `act_on_item` evaluates your authority envelope before any change: allow, ask to confirm, refuse, or escalate.
5. **Prove** — `verify_ledger` recomputes the hash chain and reports the terminal hash; `export_record` produces a voice-friendly report for a period.
6. **Escalate** — a refusal is not a dead end; `escalate_item` hands the item to your trusted contact and records it.

### The envelope

Every action is governed before it happens:

```mermaid
flowchart TD
  A[Action proposed] --> B{Forbidden by you?}
  B -->|yes| R[Refuse, speak the reason, record action_refused]
  B -->|no| C{Read with low confidence?}
  C -->|yes| D[Ask, refuse, or escalate, per your policy]
  C -->|no| E{Above your auto-act limit?}
  E -->|yes| F[Ask you to confirm]
  E -->|no| G[Act]
  F -->|you confirm| H[Act and record action_confirmed]
  G --> I[Record action_executed]
  H --> I
```

Refusals are first-class: the reason is spoken and written to the ledger, and the response offers escalation to your trusted contact.

## MCP surface

### Tools

| Tool | What it does |
|---|---|
| `capture_scan` | Start reading captured images (mail, labels, objects, scenes) |
| `get_scan` | Return the items found in a scan |
| `identify_product` | Read a label back verbatim, with a health disclaimer |
| `remember_object` | Remember where an object is |
| `find_object` | Find where an object was last seen |
| `list_items` | List items, optionally filtered |
| `get_item` | Full detail for one item |
| `get_backlog` | Threads ranked by urgency, with demands and related documents |
| `get_audit` | Ledger history for a document or thread |
| `act_on_item` | Carry out a suggested action, after the envelope decides |
| `escalate_item` | Hand an unresolved item to the trusted contact |
| `verify_ledger` | Recompute the chain and report the terminal hash |
| `export_record` | Voice-friendly situation report for a period |
| `prepare_payment` | Prepare a payment handoff (instruction + EPC QR); never moves money |
| `update_preferences` | Verbosity, trusted contact, large text |
| `daily_briefing` | Deadline-risk-ordered summary for the day |

### Resources

| Resource | Contents |
|---|---|
| `wayfinder://inbox` | The unresolved items |
| `wayfinder://objects` | Remembered objects and last-seen locations |
| `wayfinder://ledger` | The ledger entries and their verification result |
| `wayfinder://capabilities` | What is actually wired, never what is merely possible |
| `ui://wayfinder/app.html` | The interactive MCP App view |

A `morning_briefing` prompt is also exposed.

## The record

- **Append-only and hash-chained.** Each entry commits to the previous hash: `hash = SHA-256(prevHash + canonicalJSON(entry))`.
- **Redacted before hashing.** Sensitive details such as account numbers are redacted as entries are written, so the chain never commits to them in the clear.
- **Verifiable.** Verification recomputes the chain and reports the first mismatching sequence number if anything was altered.
- **Exportable.** A situation report includes the terminal hash, so a caregiver, advocate, bank, or ombudsman can check it independently.

**What "confirmation" means here, precisely.** Confirmation is *recorded confirmation*: the system records that you confirmed an action. It is not independently verified, and it is not evidence with legal weight. An unconfirmed action past its deadline is **escalated to your trusted contact — never silently assumed**. That honesty is the point: the honest claim is that the record is internally consistent and tamper-evident, and can prove what the system saw and did and that it was not altered afterwards.

## Accessibility

- **Voice-first.** Every result, refusal reason, and verification result is spoken, not screen-only.
- **Keyboard-complete.** All controls are native buttons and inputs: focus-visible outlines and at least 48px targets.
- **Large text.** A client toggle that scales the interface, synchronized with `aria-pressed`.
- **Live regions.** The transcript and the brain badge announce changes for screen readers.
- **Legible cards.** The on-screen views use plain language, one idea per card, and red/green states with text labels rather than color alone.

## Safety and privacy

- **No payment execution.** `prepare_payment` produces an instruction and a SEPA QR payload you complete in your own banking app; the ledger records that a handoff was prepared, not that money moved. Invalid account numbers are refused.
- **No advice.** Wayfinder reports what a document says; it does not give medical or financial advice.
- **No emergency response.** It does not detect or claim real-time surveillance or emergencies.
- **Minimal data.** Records and the ledger live in your `WAYFINDER_DATA_DIR`. Deleting a document purges its stored content and appends a `closed` entry recording that the purge happened, so verification reports it rather than hiding it.
- **No silent failures.** A delivery failure appends a `delivery_failed` entry and is spoken.
- **Local by default.** With no integrations configured, nothing leaves the process. Optional adapters are disabled by default, must be enabled explicitly, and redact payloads before transmit.

## Optional integrations

Wayfinder keeps optional services behind small **ports**, each with a null adapter that preserves the default behaviour. Nothing is required and nothing is enabled by default. Reference adapters ship for a webhook notifier, an ICS calendar sink, and an EPC QR payment handoff; other ports are documented recipes.

| Port | Default (null) | Reference adapter |
|---|---|---|
| `Notifier` | Ledger + spoken reply | Webhook |
| `CalendarSink` | Internal ledger | ICS file |
| `PaymentHandoff` | Spoken/text instruction + ledger | EPC QR |
| `SignatureProvider` | Local SHA-256 chain | *(recipe: KMS, RFC 3161)* |
| `DocumentSource` | Camera / upload | *(recipe: IMAP, watched folder)* |
| `AssistProvider` | None | *(recipe: Be My Eyes / Aira)* |

See the per-port recipes in [`docs/adapters/`](docs/adapters/) and validate any configuration with:

```bash
npm run adapters:conformance
```

## Project layout

```
src/
  domain/     Pure domain logic: model, correlation, authority, ledger, backlog, copy
  mcp/        MCP server: tools, resources, the app resource
  server/     HTTP host: Express app, agent endpoint, MCP transport
  scan/       Scan worker and the Bedrock image reader
  agent/      Agent brains (rule-based and Bedrock) and the MCP executor
  adapters/   Ports, null adapters, config, registry, notify queue, reference adapters
  storage/    File-backed store
ui/           The MCP App view (single self-contained HTML bundle)
web/          The demo host client (Vite)
docs/         Public documentation and adapter recipes
test/         Vitest suites
```

## Development

```bash
npm test                    # full Vitest suite (builds the UI bundle first)
npm run typecheck           # server and UI type checks
npm run lint                # ESLint
npm run adapters:conformance  # validate configured adapters
npm run format              # Prettier
```

The domain rules, the checksum and hash-chain logic, and the adapter contracts are covered by deterministic tests. Domain logic is pure where it matters: correlation, the authority decision, IBAN validation, and ledger hashing are all unit-tested without a network or a model.

## Documentation

- **[Interactive documentation](docs/index.html)** — the guide as a self-contained, searchable page (open it locally, or serve it from GitHub Pages).
- **[Adapter recipes](docs/adapters/)** — how to enable and configure each optional port.
- **[Demo script](docs/demo-script.md)** — the three-minute walkthrough, with offline fallback narration.

## License

[MIT](LICENSE).
