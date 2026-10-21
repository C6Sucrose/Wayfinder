# Wayfinder gallery

These PNGs were captured from the running Wayfinder MCP demo host with isolated,
fictional seeded data, the offline rule brain, and no document vision enabled.
The architecture image is a PNG export of `docs/diagrams/architecture.svg`.

Screenshots of the working application:

| Image | Caption |
|---|---|
| [Voice-first dashboard](01-voice-first-dashboard.png) | A voice-first daily briefing brings urgent paperwork, appointments, flagged documents, and everyday reminders together. |
| [Prioritized backlog](02-prioritized-backlog.png) | Related letters become threads ranked by urgency, with deadlines, reminder counts, and accessible document histories. |
| [Bounded-action refusal](04-bounded-action-refusal.png) | Your permissions set the boundaries: forbidden actions are refused with an explanation and an option to ask a trusted contact for help. |
| [Verifiable ledger](05-verifiable-ledger.png) | “Prove it” checks the hash-chained record and displays its final fingerprint, making changes to recorded entries detectable. |
| [Accessibility settings](06-accessibility-dark-large-text.png) | Large text, a dark host theme, reduced-motion controls, and matching text responses support different access needs. |
| [System architecture](08-system-architecture.png) | A self-hosted MCP server connects voice requests, deterministic domain rules, a local store, interactive MCP App views, and optional adapters. |

Additional images:

- [Document confidence](03-document-confidence.png): Low-confidence information is clearly labeled,
  with a request to recapture the document rather than guess at unreadable details.
- [Object memory](07-object-memory.png): Everyday object memory answers “Where are my keys?”
  using the location the user previously recorded.
