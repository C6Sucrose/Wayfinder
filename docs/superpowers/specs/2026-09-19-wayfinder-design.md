# Wayfinder — Design Spec

**Working title:** Wayfinder (concept: "Compass")
**Event:** Build, Ship, Shape: Amazon Developer Hackathon (2026)
**Primary track:** Alexa+ · **Mini challenges:** AWS Builder, Open Source
**Submission deadline:** 2026-10-23
**Spec date:** 2026-09-19
**Status:** Approved for implementation planning
**Supersedes:** `2026-09-19-hearthrail-design.md` (concept pivot)

> Name note: "Wayfinder" is a working name. The concept name "Compass" was rejected for trademark risk (e.g., Compass real-estate tech). All user-facing strings live in one place, so renaming is mechanical. A formal clearance check is an open item.

---

## 1. Summary

Wayfinder is an **Alexa+ add-on** for blind and low-vision adults. It is **voice-first and vision-powered**: the user points a camera at the world, and Wayfinder does not merely *describe* — it **acts**. It classifies documents, reads labels, remembers where objects are, and completes tasks: files the paper, schedules the appointment, sets the reminder, flags the scam, briefs the day.

Delivered as a **self-hosted MCP server** (MCP specification `2025-11-25`, Streamable HTTP, sessionful) plus:

- a **simulated Alexa+ experience** (Echo-Show-style web app with browser voice and camera capture) whose brain is Amazon Bedrock driving a **real MCP client**, and
- a **classic Alexa Skill** endpoint routing the same utterances through the same MCP server.

This satisfies **both** Alexa+ submission paths while proving the integration on Amazon's own stack.

### One-line pitch
> Point your camera at your paper, your labels, and your home — Wayfinder reads it, files it, schedules it, and remembers it, all by voice.

---

## 2. Problem & Impact

Blind and low-vision people routinely face **unstructured visual tasks** that interrupt independence: telling apart mail (bill vs. appointment vs. scam), reading a prescription or food label, locating a misplaced object, and keeping track of deadlines. Existing assistive apps are strong at **description** but stop short of **completing the task** — the user still has to remember the date, file the paper, and manage the follow-up.

Wayfinder closes the loop from *seeing* to *done*, on a voice-first device, with an emphasis on privacy and European accessibility standards.

**Target users**
- **Primary — "Maya, 28":** blind since birth; expert screen-reader and voice user; values speed, precision, and not being over-explained.
- **Primary — "Herr Weber, 74":** progressive vision loss; lower tech confidence; benefits from voice plus large-text, high-contrast visuals.
- **Secondary — trusted contact** (family member or assistant): receives shared items and summaries.
- **Not a user:** businesses. Per policy §10 the add-on is end-consumer only.

**European relevance (enhances Potential Impact)**
- The **EU Accessibility Act (EAA)** compliance deadline was **28 June 2025**; Germany transposed it as the **BFSG (Barrierefreiheitsstärkungsgesetz)**, with harmonized standard **EN 301 549**. Wayfinder is designed to align with this regime.
- Assistive technology is a recognized social priority, with partial reimbursement pathways (Hilfsmittel) in Germany.
- Wayfinder is designed for **EU data residency** (`eu-central-1`, Frankfurt) and a **de-DE** localization path.

---

## 3. Hackathon Context & Constraints

- **Track technology (required):** self-hosted MCP server, spec `2025-11-25` or later, **Streamable HTTP**.
- **Toolkit availability:** the Alexa+ add-on toolkit (Alexa AI CLI, web simulator, Local Inspector) is **Private Preview** and, per organizers, **not available to hackathon participants**. The build therefore demos via (a) a simulated experience and (b) a classic Alexa Skill, while remaining **certification-ready** (auth, manifest, MCP Apps, latency).
- **Latency rule:** Alexa+ budgets **< 500 ms** per tool call. Image analysis is heavy, so it runs in an **async worker**, never in a tool handler.
- **Category:** MCP Toolkit (not a pre-built Category SDK category).
- **Mini challenges pursued:**
  - **AWS Builder** — Bedrock (vision + brain), App Runner, DynamoDB, S3, Secrets Manager; documented in CDK and product feedback.
  - **Open Source** — public, MIT-licensed, plus an additional open-source contribution.
- **Bonus:** friction log (up to +10%).

### Timeline
2026-09-19 → 2026-10-23 = **34 days**.

---

## 4. Competitive Landscape & Differentiation

**Incumbents (description-first):** Microsoft **Seeing AI**, Google **Lookout**, **Be My Eyes / Be My AI**, **Aira** (human agents), **Envision**. All are strong at scene/OCR description.

**Wayfinder differentiation:**
1. **Acts, not just describes** — a document classifier, typed field extractors, a scam heuristic scorer, and an action planner complete tasks (§10 domain logic, not an LLM relay).
2. **MCP-native** — one server usable by any MCP host; positioned for the Alexa+ ecosystem rather than a single proprietary app.
3. **Household object memory** — "where are my keys?" is a genuine, underserved need.
4. **European-first** — EAA/BFSG alignment, EU data residency, de-DE path, privacy-minimal.
5. **Voice-first accessibility** — designed to be driven entirely by voice and a screen reader.

**Hackathon prior art:** no visible Alexa+ accessibility entry in the public repos surveyed to date (eldercare, energy, recalls, chores, UI-meta are claimed instead).

---

## 5. Compliance Strategy (hard constraints)

| Source | Requirement | Wayfinder design |
|---|---|---|
| §4 Policy | Must not target children | Adult product; no child personas or data. |
| §10 Policy | End-consumer; must add domain-specific value, not LLM relay | Classifier + extractors + scam heuristics + action planner + object memory are the core; the model is an extractor/reader. |
| §9 Policy | Attribute factual info to a named source | Scam-pattern explanations carry a `reason`; general facts attributed (e.g., "According to <source>…"). |
| §13 Policy | Health/medical: no cure/emergency claims, disclaimers; drug dosage requires manufacturer affiliation | Wayfinder **reads labels verbatim** and never interprets medically. Medication/food read-backs include: *"This is the text on the label, not medical advice. Consult a healthcare provider."* Health questions are redirected. No emergency capability is claimed. |
| §14 Policy | Financial services rules, no directive advice, no instruments | Wayfinder is **not a financial add-on**. It extracts due dates/amounts; it never advises and stores no payment instruments. Account numbers are **masked** (`••••1234`) and never recited in full. |
| §16 Policy | Retail shopping rules | **Reordering is out of scope** to avoid shopping obligations. |
| §3 Policy | Privacy: policy/ToS URLs, one-time disclosure, minimal PII, no PII by voice, no unrelated schema fields | Static privacy/ToS pages; first-run disclosure; masked identifiers; images retained only as long as needed and deletable on request; no free-text PII fields beyond declared purpose. |
| §1/§8 Code | No trademark misuse; original assets | Own name/marks; original assets; attributed statistics. |
| §8 Functional | Accurate metadata; no prices | Store metadata has no monetary amounts; every claimed capability is implemented. |
| §13 Functional | Every listed MCP tool invocable; valid `inputSchema`; stable IDs | CI validates `tools/list`; conformance probe; stable IDs (`scanId`, `itemId`, `objectId`). |
| §2 Functional | Graceful errors, no jargon | Customer-safe structured errors; one most-likely next step; no codes/JSON/tool names. |
| §1 Functional | Context & continuity | Independent parameters; session-expiry message; explicit "start over". |
| §3/§9/§10/§11 Functional | Device availability, voice-only, cross-modal consistency, visuals | Every critical flow works voice-only; ≤5 options; read-back + "yes" before actions; TTS and visuals never contradict. |
| Accessibility | Product must itself be accessible (EAA/BFSG) | Voice-first; screen-reader-safe semantics; large-text, high-contrast visuals; WCAG-aligned; keyboard/touch parity. |

**Non-goals:** medical diagnosis/triage, emergency response, real-time navigation, financial advice, real-money transactions, reordering/purchases, B2B.

---

## 6. Scope

### In scope (MVP)
- Camera scan → **document classification** and **typed field extraction**.
- **Scam heuristic scoring** with explainable reasons.
- **Action planner** and execution: reminders, calendar entries, flags, filing, sharing.
- **Product/label identification** with verbatim read-back + disclaimers.
- **Household object memory** (remember / find).
- **Daily briefing**.
- Simulated Alexa+ client (voice + camera) with MCP Apps UI; classic Alexa Skill.
- Bedrock brain + deterministic rule fallback.
- AWS deployment (EU region) via CDK.
- Tests, metrics, conformance probe, docs, product feedback, friction log.

### Stretch (only if M1–M5 land early)
- Trusted-contact notifications (SMS/email) for shared items.
- Multi-language (de-DE) read-back and locale-aware date/currency.
- Guided physical-task coaching.

---

## 7. Architecture

### 7.1 Component diagram

```
┌───────────────────────────────┐     ┌───────────────────────────────┐
│ Simulated Alexa+ web client   │     │ Classic Alexa Skill            │
│ (Echo-Show style, Web Speech, │     │ (real device / Alexa simulator)│
│  camera/file capture)         │     └───────────────┬───────────────┘
└───────────────┬───────────────┘                     │ POST /alexa
                │ POST /api/agent                     │
                ▼                                     ▼
        ┌─────────────────────────────────────────────────────┐
        │ Agent brain: Bedrock (Claude, Converse tool loop)   │
        │ + deterministic rule-based fallback                 │
        │ acts as a real MCP client (StreamableHTTPClientTx)  │
        └───────────────────────────┬─────────────────────────┘
                                    │ MCP 2025-11-25 / Streamable HTTP
                                    ▼
        ┌─────────────────────────────────────────────────────┐
        │ Wayfinder MCP server (Node 22+, TypeScript, ESM)    │
        │  /mcp  POST|GET|DELETE (sessionful)  · stdio binary │
        │  domain: classifier · field extractors · scam       │
        │          heuristics · action planner · object memory│
        │  async scan worker (Bedrock multimodal)             │
        │  MCP Apps bundle: ui://wayfinder/app-<hash>.html    │
        │  OAuth 2.1 AS (tier1 client_credentials, tier2 PKCE)│
        └───────┬───────────────────────┬─────────────────────┘
                │                       │
        ┌───────▼───────┐       ┌───────▼───────────┐
        │ SQLite (dev)  │       │ DynamoDB + S3     │
        │ Storage iface │       │ eu-central-1 (prod)│
        └───────────────┘       └───────────────────┘
```

### 7.2 Components
1. **MCP server** — TypeScript, `@modelcontextprotocol/sdk`; sessionful Streamable HTTP at `/mcp` (POST/GET/DELETE, `MCP-Session-Id`) plus a `wayfinder-mcp` stdio binary; Origin validation; 401 without `WWW-Authenticate`.
2. **Domain core** — pure, unit-tested: `documentClassifier`, `fieldExtractors`, `scamHeuristics`, `actionPlanner`, `objectMemory`. No I/O, no model calls.
3. **Scan worker** — asynchronous. Bedrock multimodal extracts conditions/text into validated schemas, then domain logic decides classification, fields, risk, and actions. Deterministic fallback when Bedrock is unavailable.
4. **Storage interface** — `FileStore`/`SQLiteStore` (dev) and `DynamoStore` (prod).
5. **MCP Apps UI** — one content-hashed bundle; screens: item cards, inbox, detail, label read-back, object memory, briefing. Voice-first; large-text/high-contrast for low-vision.
6. **Agent brain** — Bedrock Converse tool-use loop over a real MCP client; `ruleBrain` fallback; API reports which brain answered.
7. **Simulated Alexa+ client** — Vite + React + Tailwind; Web Speech API; camera/file capture; renders MCP Apps via the ext-apps host bridge.
8. **Classic Alexa Skill endpoint** — `POST /alexa`, signature-verified; intents → utterances → same brain → speech + APL card.
9. **AWS infrastructure** — CDK: App Runner, DynamoDB, S3, Secrets Manager, Bedrock IAM; **`eu-central-1`** for EU data residency.
10. **Ops** — `/healthz`, `/metrics.json` (per-tool p50/p95), structured logs, `scripts/verify-live.mjs` conformance probe.

---

## 8. MCP Surface

### 8.1 Tools

| # | Tool | Inputs | Output | Screen |
|---|------|--------|--------|--------|
| 1 | `capture_scan` | `imageRefs[]`, `hint` (`mail`\|`label`\|`object`\|`scene`\|`auto`) | `scanId`, interim spoken text | — |
| 2 | `get_scan` | `scanId` | `items[]` (`itemId`, `class`, `confidence`, `fields`, `proposedActions[]`, `readAloudText`) | item cards |
| 3 | `act_on_item` | `itemId`, `action` (`remind`\|`schedule`\|`flag`\|`file`\|`share`\|`discard`), `params` | confirmation | action buttons |
| 4 | `list_items` | `filter` (`unresolved`\|`due`\|`flagged`\|`all`) | `items[]` | inbox |
| 5 | `get_item` | `itemId` | full detail + read-aloud text | detail |
| 6 | `identify_product` | `imageRefs[]` | `{name, category, expiry, ingredients, allergens, labelText, disclaimer}` | label read-back |
| 7 | `remember_object` | `objectName`, `imageRefs[]`, `locationNote?` | `objectId`, confirmation | object card |
| 8 | `find_object` | `objectName` | `{found, locationNote, lastSeenAt}` | object card |
| 9 | `daily_briefing` | `date?` | `{due[], appointments[], flagged[], objectReminders[]}` | briefing |
| 10 | `update_preferences` | `verbosity`, `trustedContactAlias?`, `largeText?` | updated preferences | preferences |

**Resources:** `wayfinder://inbox` (unresolved items), `wayfinder://objects` (object memory).
**Prompt:** `morning_briefing`.

**Async + push:** `capture_scan` starts a job and returns `scanId` + interim; the worker finishes and the server pushes `notifications/message`; `get_scan` then returns items. This keeps synchronous handlers inside the 500 ms budget.

### 8.2 Tool-design rules
- One tool = one intent; no overlapping tools.
- Declare only honored parameters; every `inputSchema` field is used and validated.
- Always return something; structured errors use `isError: true` / JSON-RPC errors.
- Customer text carries no IDs, URLs, JSON, or tool names.

---

## 9. Domain Model

- **Scan** `{ scanId, hint, imageRefs[], status: queued|analyzing|ready|failed, createdAt }`
- **Item** `{ itemId, scanId, class, confidence, readAloudText, fields, proposedActions[], createdAt, resolvedAt|null }`
- **Fields (typed per class):** `sender`, `dueDate`, `amount`, `currency`, `appointmentAt`, `reference`, `actionRequired`, `maskedAccount`
- **Action** `{ actionId, itemId, type, params, status: proposed|confirmed|done|failed }`
- **Object** `{ objectId, name, locationNote, lastSeenAt, imageRef }`
- **Preferences** `{ verbosity: brief|normal|detailed, trustedContactAlias|null, largeText: bool, locale }`

### 9.1 Document classes
`bill | appointment | insurance | government | receipt | personal | junk | scam | label`

### 9.2 Classification & extraction pipeline
1. **Vision + OCR** (Bedrock multimodal) produces raw text and light layout signals (sender block, date block, salutation, QR/link presence).
2. **Classifier** — deterministic keyword/pattern rules per class, with the model used only for the ambiguous band; returns class + confidence.
3. **Field extractors** — class-specific typed extraction (dates normalized to ISO; amounts to `{value, currency}`; account numbers **masked**), validated against schemas.
4. **Scam scorer** — deterministic features: urgency lexicon, payment/gift-card requests, sender/return-address mismatch, embedded QR/link, formatting anomalies → `riskScore` + written `reason`. Model adjudicates only `0.5–0.8`.
5. **Action planner** — maps class + fields → proposed, idempotent actions (e.g., appointment → `schedule`; bill → `remind`; scam → `flag`).
6. **Low confidence** → ask a disambiguating question rather than guessing.

The model **never** invents content: it reports what it can read. This satisfies §10 and keeps outcomes explainable.

### 9.3 Read-back rules
- Medication/food labels: **verbatim** label text + standing disclaimer; health questions redirected.
- Financial documents: due date and amount only; account numbers masked and never spoken in full; no advice.
- Every read-back offers "read it again", "slower", or "spell that".

---

## 10. Data Flow

### 10.1 Scan → classify → act
1. "Wayfinder, read my mail." → `capture_scan(["img1","img2"], "mail")` → `scanId` + interim.
2. Worker: OCR/vision → classifier → extractors → scam scorer → action planner; persists items.
3. Server pushes `notifications/message`.
4. `get_scan(scanId)` → items (e.g., "two bills, one appointment, one likely scam, one junk").
5. "Add the appointment and remind me about the bills." → `act_on_item(...)` for each → confirmations.

### 10.2 Object memory
1. "Remember my keys are on the entry table." → `remember_object("keys", ["img"], "entry table")`.
2. Later: "Where are my keys?" → `find_object("keys")` → "Last seen on the entry table, Tuesday at 6:10 PM."

### 10.3 Label read-back
1. "What's in my hand?" → `identify_product(["img"])` → name/expiry/allergens + verbatim + disclaimer.

### 10.4 Daily briefing
`daily_briefing()` → due items, appointments, flags, object reminders; also pushed proactively.

---

## 11. Authentication & Security

- **Model:** two-tier OAuth 2.1 — Tier 1 `client_credentials` (`mcp:service`) for `initialize`/`tools/list`/health; Tier 2 `authorization_code` + **PKCE S256** (`mcp:tools`, `mcp:resources`) for user tools.
- **Metadata:** `/.well-known/oauth-protected-resource` (RFC 9728) and `/.well-known/oauth-authorization-server`.
- **Token endpoint:** `POST /oauth/token`; HTTP Basic client auth; `resource` validated; tokens ≤ 3600 s; no refresh token for client credentials.
- **401 without `WWW-Authenticate`**; no DCR, OIDC, CIMD, or step-up.
- **Dev mode:** `AUTH_MODE=dev` bypass; demo profile is synthetic.
- **Privacy:** images encrypted at rest (S3 SSE), retention configurable and deletable on request; no PII in logs; masked identifiers only.
- **EU residency:** production deployment targeted at `eu-central-1`.

---

## 12. MCP Apps UI (voice-first)

- Voice is the primary channel; every screen's information is also in `content[0].text`.
- Visuals enhance low-vision use: large text, high contrast, ≥48 px targets, host theme variables, safe-area insets, inline + fullscreen.
- Follows the Alexa+ MCP design guide; strict CSP; screen-reader-safe semantics.
- Action buttons call tools through the host bridge and push results into the model's context for continuity.

---

## 13. Agent Brain

- **Primary:** Amazon Bedrock (Claude) Converse tool-use loop over a real MCP client — no shortcut into the domain layer.
- **Fallback:** `ruleBrain` intent router driving the same tools; `/api/agent/status` reports the active brain.
- **Disclosure:** the simulated client states it is a simulation of Alexa+ (no implied affiliation, §1).

---

## 14. Simulated Client & Classic Skill

- **Sim client:** Echo-Show-style frame + companion panel; browser speech in/out; camera/file capture; MCP Apps rendered inline; demo menu to reset/reseed.
- **Classic Skill:** `POST /alexa` verifies the ASK signature over the raw body, maps intents → utterances, runs the same brain, responds with speech + card/APL. Enables demo on Amazon's Alexa simulator or a real device.

---

## 15. AWS Infrastructure (AWS Builder mini)

- **App Runner** — hosts MCP server + web app + skill endpoint (`ServiceUrl` → `PUBLIC_URL`).
- **DynamoDB** — scans, items, actions, objects, preferences.
- **S3** — scan images (SSE, lifecycle expiry).
- **Secrets Manager** — OAuth client secret, Bedrock config.
- **IAM** — least-privilege Bedrock `InvokeModel`.
- **Bedrock** — Claude multimodal (vision/OCR) + Converse (brain).
- **Region:** `eu-central-1` (EU data residency).
- Local development needs no AWS: `AUTH_MODE=dev`, file store, rule brain.

---

## 16. Error Handling & UX Requirements

- **No empty responses.** Every tool returns success or a structured error.
- **Actionable messages.** e.g., blurry image → "I couldn't read that clearly — could you hold it steadier or move to better light?"
- **No jargon.** No codes, JSON, tool names, or IDs spoken.
- **State preserved** across mid-flow errors; one most-likely next step.
- **Voice-only** for all critical flows; ≤5 options; read-back + "yes" before actions.
- **Cross-modal consistency:** spoken and on-screen values always match; no stale content.
- **Confirmations:** any action that files, discards, shares, or schedules is confirmed first and reversible where possible.

---

## 17. Testing Strategy

- **Unit:** classifier, field extractors, scam heuristics (each feature + score band), action planner idempotency, object memory, time/seed.
- **Integration:** every tool over the SDK MCP client; session lifecycle; MCP App resource; auth conformance (tiers 1/2, 401 shape, PRM/auth metadata).
- **Latency:** assert **p95 < 500 ms** per tool via `/metrics.json`.
- **Agent:** smoke test of the demo beats through `POST /api/agent`, asserting brain + tools used; rule-brain parity.
- **E2E:** scripted voice-shaped conversations with committed transcripts.
- **Conformance:** `scripts/verify-live.mjs` graded probe; non-zero exit on failure.
- **Accessibility:** automated axe checks on the web client; screen-reader smoke path; contrast checks.
- **CI:** GitHub Actions — install, typecheck, lint, test, build.

---

## 18. Project Structure

```
src/
  server/      config, logging, http routes (/mcp, /healthz, /metrics.json, /alexa, /api/agent)
  domain/      model, documentClassifier, fieldExtractors, scamHeuristics, actionPlanner, objectMemory, time, seed
  storage/     storage interface, file/sqlite store, dynamo store
  mcp/         tools, resources, prompts, schemas, apps registration
  scan/        vision/ocr extractor (Bedrock), worker, schemas
  agent/       bedrockBrain, ruleBrain, mcpExecutor, service
  auth/        oauth server, token endpoints, metadata documents
ui/            MCP App bundle (React single-file build → dist/ui/app-<hash>.html)
web/           simulated Alexa+ client (Vite + React + Tailwind, Web Speech, capture)
infra/         AWS CDK (App Runner, DynamoDB, S3, Secrets Manager, IAM; eu-central-1)
scripts/       verify-live.mjs, seed, smoke, oauth conformance, axe
addon-package/ addon.json manifest (certification-ready)
docs/          spec, product feedback, friction log, demo script, evidence
test/          vitest suites
```

---

## 19. Delivery Plan

| Milestone | Days | Deliverable | Exit test |
|-----------|------|-------------|-----------|
| **M0** Walking skeleton | 1–3 | Sessionful Streamable HTTP + stdio + CI | lifecycle tests green |
| **M1** Domain core | 4–8 | Classifier, extractors, scam heuristics, action planner, object memory, seed | unit tests green |
| **M2** MCP surface + UI | 9–14 | 10 tools + resources + prompt + MCP App bundle | integration + latency green |
| **M3** Scan worker + brain + sim client | 15–19 | Async Bedrock vision + fallback + web client (voice + camera) | demo beats pass |
| **M4** Classic Skill | 20–23 | `/alexa` endpoint | simulator walkthrough |
| **M5** AWS + auth + conformance | 24–27 | CDK deploy (eu-central-1) + OAuth tiers + probe + metrics | probe exits 0 |
| **M6** Docs + polish + a11y | 28–31 | Product feedback, friction log, demo script, README, LICENSE, axe clean | repo complete |
| **M7** Video + submit | 32–34 | <3 min demo video, submission, collaborators | submitted |

---

## 20. Submission Artifacts

- Public **MIT-licensed** repository (Open Source mini) with run instructions.
- Demo video **under 3 minutes**, public, English.
- Product feedback for every tool/API/SDK and AWS service used.
- Track + mini-challenge declaration.
- **Friction log** (bonus).
- Optional feature requests.
- A second, separate open-source contribution for the Open Source mini.
- Add Amazon reviewers as collaborators **at submission time** (invites expire in 7 days).

---

## 21. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| OCR/vision accuracy on real documents | Medium | Curated demo documents; confidence thresholds; disambiguation questions; deterministic fallback. |
| Accessibility demo authenticity | Medium | Voice-first design; staging shows hands-free operation; large-text visuals for low-vision. |
| Policy misstep (medical/financial framing) | Low | Verbatim read-back + disclaimers; redirection; masked identifiers; no advice; reordering out of scope. |
| Privacy/GDPR scrutiny | Medium | EU region, data minimization, retention controls, deletion; no PII in logs. |
| Bedrock access not yet enabled | Medium | Rule brain is a first-class fallback. |
| Alexa+ toolkit unavailable | Certain | Sim client + classic Skill are the demo paths; server stays certification-ready. |
| Scope creep | Medium | Stretch features deferred behind M1–M5. |
| Name/trademark | Medium | Working name pending clearance; rename is one file. |
| AWS cost | Low | App Runner scale-to-zero; free-tier DynamoDB/S3; documented limits. |

---

## 22. Open Questions

1. **Trusted-contact notifications** (SMS/email) — stretch only.
2. **de-DE localization** — stretch; English demo for judging.
3. **Final name clearance** — "Wayfinder" is a working name.
4. **Image retention default** — propose: deleted after item resolution unless user keeps them.

---

## 23. License

MIT. Third-party statistics and standards are attributed, not reproduced.
