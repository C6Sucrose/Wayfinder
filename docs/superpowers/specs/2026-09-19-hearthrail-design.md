# HearthRail — Design Spec

**Working title:** HearthRail
**Event:** Build, Ship, Shape: Amazon Developer Hackathon (2026)
**Primary track:** Alexa+ · **Mini challenges:** AWS Builder, Open Source
**Submission deadline:** 2026-10-23
**Spec date:** 2026-09-19
**Status:** SUPERSEDED — concept pivoted to Wayfinder (`2026-09-19-wayfinder-design.md`)

> **SUPERSEDED:** This spec describes the original "home accessibility/safety services" concept. After a viability/attractiveness review it was replaced by the Wayfinder spec (blind/low-vision copilot). Kept for history only. Nothing in this document is authoritative.

> Name note: "HearthRail" returned no meaningful web/trademark hits in the sanity check; it is a working name pending a formal clearance. The previous candidates "Threshold" (Target brand) and "SteadyHome" were rejected/not chosen. Renaming is a find-and-replace because all user-facing strings live in one place.

---

## 1. Summary

HearthRail is an **Alexa+ add-on** that helps older adults and people with disabilities stay safely in their homes. A user (or their family caregiver) describes or photographs a room; HearthRail turns that into a **prioritized, costed home-safety and accessibility plan**, then **finds, quotes, books, and tracks vetted local professionals** to complete the work.

It is delivered as a **self-hosted MCP server** (MCP specification `2025-11-25`, Streamable HTTP, sessionful) plus:

- a **simulated Alexa+ experience** (an Echo-Show-style web app with browser voice) whose brain is Amazon Bedrock driving a **real MCP client**, and
- a **classic Alexa Skill** endpoint that routes the same utterances through the same MCP server, so the integration can be demonstrated on Amazon's Alexa simulator or a real device.

This dual-front-end approach satisfies **both** Alexa+ submission paths (self-hosted MCP server *and* simulated experience) while proving the integration works on Amazon's own stack.

### One-line pitch
> Point your phone at a room. Get a safety plan, a trustworthy installer, and a booked appointment — without leaving the conversation.

---

## 2. Problem & Impact

Falls are the leading cause of injury-related death among adults 65+, and most falls happen at home. Missing grab bars, high thresholds, poor lighting, and loose rugs are well-documented, **fixable** hazards, yet remediation has a discovery problem: people do not know what to look for, do not know who to call, and do not know what a fix should cost. Family caregivers often live far away and coordinate by phone.

HearthRail collapses *discovery → plan → trust → booking* into a single voice-native experience, on a device (Alexa) that is already in the room where the hazard exists.

**Target users**
- **Primary — "Margaret, 72":** lives alone, wants to age in place, low technical confidence. Interacts by voice.
- **Secondary — "Priya, 45":** Margaret's daughter, a remote caregiver who sets the system up and monitors progress.
- **Secondary — "Alex, 34":** wheelchair user who needs an accessible retrofit and knows what they want but not who to hire.
- **Not a user:** service providers/businesses. Per policy §10 the add-on must be end-consumer facing; providers are data, not users.

---

## 3. Hackathon Context & Constraints

- **Track technology (required):** self-hosted MCP server, spec `2025-11-25` or later, **Streamable HTTP**.
- **Toolkit availability:** the Alexa+ add-on toolkit (Alexa AI CLI, web simulator, Local Inspector) is **Private Preview** and, per organizers, **not available to hackathon participants**. Therefore the build must stand on its own and demo via (a) a simulated experience and (b) a classic Alexa Skill. Our MCP server is nonetheless designed to be **certification-ready** (auth, manifest, MCP Apps, latency) so the repo demonstrates mastery of the real integration path.
- **Latency rule:** Alexa+ budgets **< 500 ms** per tool call. No tool handler may do network or model I/O.
- **Category:** MCP Toolkit (service does not fit a pre-built Category SDK category), positioned conceptually alongside the *Home Services* category.
- **Mini challenges pursued:**
  - **AWS Builder** — Bedrock (vision + brain), App Runner, DynamoDB, S3, Secrets Manager; documented in the AWS CDK and product feedback.
  - **Open Source** — public, MIT-licensed, plus an additional open-source contribution.
- **Bonus:** friction log (up to +10%).

### Timeline
Today 2026-09-19 → deadline 2026-10-23 = **34 days**.

---

## 4. Competitive Landscape & Differentiation

Publicly visible Alexa+ MCP entries for this hackathon claim: eldercare medication coordination (`carecompanion`), home energy (`powerline`), household inventory + product recalls (`custodian`), domestic waiting jobs (`dwell`), interactive-UI meta (`show-dont-tell`), and daily affirmations.

HearthRail is differentiated by:
1. **Domain logic, not an LLM relay** (policy §10): a curated **hazard rule engine** decides findings, severity, and recommendations; the model only extracts observable conditions.
2. **Transactability:** a real provider-matching and booking state machine — the Amazon-native "task completion" pattern.
3. **Home accessibility/safety** is an unclaimed, credible, high-impact niche with concrete commercial buyers (home-services marketplaces, insurers, Medicare Advantage supplemental benefits).

---

## 5. Compliance Strategy (hard constraints)

Extracted from Amazon's Policy and Functional Requirements. Every item is a design obligation.

| Source | Requirement | HearthRail design |
|---|---|---|
| §4 Policy | Must not target children | Adult product only; no child personas, no child data. |
| §10 Policy | Must be end-consumer; must add domain-specific value, not LLM relay | Deterministic rule engine + booking state machine are the core; the LLM is an extractor only. |
| §9 Policy | Attribute factual info to a named source | Every finding carries an `attribution` string (e.g., "CDC STEADI", "AARP HomeFit", "ADA Standards"). |
| §13 Policy | Health content: no cure/emergency claims, disclaimers | Language is **observational and home-safety framed**, never diagnostic; a standing disclaimer: *"HearthRail provides home-safety information, not medical advice."* No emergency-intervention claims. |
| §15 Policy | Booking: confirm before executing, written confirmation, cancellation | `book_service` requires explicit confirmation; written confirmation via notification + card; `cancel_booking` reads back policy and re-confirms. |
| §14 Policy | Financial services rules | **No financial product.** Payment is a demo checkout with pre-configured methods only; no new payees/methods; no investment/advice content. |
| §3 Policy | Privacy: policy/ToS URLs, one-time disclosure, minimal PII, no PII by voice, no unrelated schema fields | Static privacy/ToS pages; first-run disclosure; store no free-text PII beyond an optional contact alias; never speak a full address; every tool field maps to purpose. |
| §1/§8 Code | No trademark misuse; no copyrighted assets | Own name/marks; original assets; third-party statistics attributed, not reproduced at length. |
| §8 Functional | Metadata accurate; no prices in metadata | Store metadata contains no monetary amounts; all capabilities listed are implemented. |
| §13 Functional | Every listed MCP tool invocable; valid `inputSchema`; stable IDs | Tools validated in CI; `tools/list` conformance probe; IDs (`homeId`, `jobId`, `quoteId`, `bookingId`) threaded across calls. |
| §2 Functional | Graceful errors, no jargon | Structured errors with customer-safe messages; a single most-likely next step. |
| §1 Functional | Context & continuity | Parameters updatable independently; session-expiry message; explicit "start over". |
| §3/§9/§10/§11 Functional | Device availability, voice-only, cross-modal consistency, visuals | Every critical flow works voice-only; ≤5 options; read-back + "yes"; TTS and visuals never contradict. |

**Non-goals (explicitly out):** medical diagnosis or triage, emergency response capability, real-time monitoring, hardware, B2B/enterprise workflows, real-money transactions.

---

## 6. Scope

### In scope (MVP)
- Voice-driven **space assessment** from photos (async) with cited findings.
- **Prioritized, costed plan**.
- **Provider matching** and ranking.
- **Quote request**, **booking** (confirm/cancel), **tracking**.
- Simulated Alexa+ web client with voice + MCP Apps UI.
- Classic Alexa Skill front end.
- Bedrock brain + deterministic rule brain fallback.
- AWS deployment via CDK.
- Tests, metrics, conformance probe, docs, product feedback, friction log.

### Stretch (only if M1–M5 land early)
- **Benefits & funding finder** (e.g., VA HISA/SAH grants, Medicare Advantage supplemental benefits, state programs) — informational and attributed only.
- Proactive seasonal re-checks via server-push notifications.
- Multi-home / caregiver sharing.

---

## 7. Architecture

### 7.1 Component diagram

```
┌───────────────────────────────┐     ┌───────────────────────────────┐
│ Simulated Alexa+ web client   │     │ Classic Alexa Skill            │
│ (Echo-Show style, Web Speech) │     │ (real device / Alexa simulator)│
└───────────────┬───────────────┘     └───────────────┬───────────────┘
                │ POST /api/agent                     │ POST /alexa
                ▼                                     ▼
        ┌─────────────────────────────────────────────────────┐
        │ Agent brain: Bedrock (Claude, Converse tool loop)   │
        │ + deterministic rule-based fallback                 │
        │ acts as a real MCP client (StreamableHTTPClientTx)  │
        └───────────────────────────┬─────────────────────────┘
                                    │ MCP 2025-11-25 / Streamable HTTP
                                    ▼
        ┌─────────────────────────────────────────────────────┐
        │ HearthRail MCP server (Node 22+, TypeScript, ESM)   │
        │  /mcp  POST|GET|DELETE (sessionful)  · stdio binary │
        │  domain: hazard rule engine · plan builder ·         │
        │          provider matcher · booking state machine    │
        │  async assess worker (Bedrock multimodal)            │
        │  MCP Apps bundle: ui://hearthrail/app-<hash>.html    │
        │  OAuth 2.1 AS (tier1 client_credentials, tier2 PKCE) │
        └───────┬───────────────────────┬─────────────────────┘
                │                       │
        ┌───────▼───────┐       ┌───────▼───────────┐
        │ SQLite (dev)  │       │ DynamoDB + S3     │
        │ Storage iface │       │ (prod, via CDK)   │
        └───────────────┘       └───────────────────┘
```

### 7.2 Components

1. **MCP server** — TypeScript, `@modelcontextprotocol/sdk`. Sessionful Streamable HTTP at `/mcp` (POST/GET/DELETE with `MCP-Session-Id`), plus a `hearthrail-mcp` stdio binary. Origin validation; no `WWW-Authenticate` on 401.
2. **Domain core** — pure functions, exhaustively unit-tested: `hazardRules`, `planBuilder`, `providerMatcher`, `bookingMachine`. No I/O, no model calls.
3. **Assessment worker** — asynchronous. Extracts *observable conditions* from images with Bedrock multimodal (Claude) into a validated schema, then applies the rule engine. Deterministic fallback path when Bedrock is unavailable.
4. **Storage interface** — `FileStore`/`SQLiteStore` (dev) and `DynamoStore` (prod) behind one interface.
5. **MCP Apps UI** — one content-hashed single-file bundle (`@modelcontextprotocol/ext-apps`) with screens: findings, plan, providers, quote, booking, tracking. Inline + fullscreen; host theme variables.
6. **Agent brain** — Bedrock Converse tool-use loop over a real MCP client; `ruleBrain` fallback.
7. **Simulated Alexa+ client** — Vite + React + Tailwind; Web Speech API for STT/TTS; renders MCP Apps via the ext-apps host bridge.
8. **Classic Alexa Skill endpoint** — `POST /alexa`, request-signature verified; maps intents to utterances → same brain → speech + APL card.
9. **AWS infrastructure** — AWS CDK (TypeScript): App Runner, DynamoDB, S3, Secrets Manager, Bedrock IAM.
10. **Ops** — `/healthz`, `/metrics.json` (per-tool p50/p95), structured logs, `scripts/verify-live.mjs` conformance probe (stand-in for the unavailable Local Inspector).

---

## 8. MCP Surface

### 8.1 Tools

Each tool returns spoken-ready text in `content[0].text` and typed `structuredContent` with a declared `outputSchema`. Stable IDs are returned so flows chain reliably (§13 Functional).

| # | Tool | Inputs | Output | Screen |
|---|------|--------|--------|--------|
| 1 | `assess_space` | `homeId`, `spaceType` (enum), `imageRefs[]` | `jobId`, interim spoken text | — |
| 2 | `get_assessment` | `jobId` | `findings[]` (each: `findingId`, `hazardType`, `severity`, `confidence`, `evidence`, `recommendation`, `diyEligible`, `costRange {low,high,currency}`, `attribution`) | findings cards |
| 3 | `get_plan` | `homeId` | `items[]` prioritized, each with `itemId`, `hazardId`, `title`, `priority`, `costRange`, `serviceType` | plan |
| 4 | `find_providers` | `serviceType`, `zip`, `constraints?` | ranked `providers[]` (`providerId`, `name`, `rating`, `certifications[]`, `distanceMiles`, `availability`) | provider list |
| 5 | `request_quote` | `providerId`, `itemIds[]` | `quoteId`, `lineItems[]`, `total`, `availableWindows[]` | quote |
| 6 | `book_service` | `quoteId`, `windowId`, `contactAlias?`, `confirmation` (must be explicit) | `bookingId`, `status`, `confirmationCode`, `writtenConfirmationSent` | confirmation |
| 7 | `get_booking` | `bookingId` | `status`, `details` | booking detail |
| 8 | `cancel_booking` | `bookingId`, `confirmation` | `status`, `cancellationPolicyRead`, `refundNote` | cancellation |
| 9 | `track_home` | `homeId` | `completed[]`, `warranties[]`, `upcomingReminders[]` | tracking |
| 10 | `update_profile` | `homeId`, `mobilityAids?`, `vision?`, `budgetBand?`, `diyWillingness?` | updated profile | profile |

**Resources:** `hearthrail://home/{homeId}/report` (JSON plan+findings), `hearthrail://providers/{serviceType}` (catalog, public).
**Prompt:** `home_safety_review` — a templated guided review flow.

**Async + push:** `assess_space` returns immediately with `jobId`; the worker completes the analysis and the server pushes `notifications/message`; `get_assessment` then returns findings. This keeps every synchronous tool handler inside the 500 ms budget.

### 8.2 Tool-design rules
- One tool = one customer intent; no overlapping tools.
- Declare only honored parameters; every `inputSchema` field is used.
- Always return something; structured errors use `isError: true` / JSON-RPC errors.
- Customer-facing text carries no IDs, URLs, JSON, or tool names.

---

## 9. Domain Model

- **Home** `{ homeId, label, zip, profile, createdAt }`
- **Profile** `{ mobilityAids: enum[]|unknown, vision: enum|unknown, priorFalls: bool|null, budgetBand: enum|null, diyWillingness: enum|null, pets: bool|null }`
- **Assessment** `{ jobId, homeId, spaceType, status: queued|analyzing|ready|failed, imageRefs[], createdAt }`
- **Finding** `{ findingId, assessmentId, hazardType, severity: high|medium|low, confidence: number, evidence, recommendation, diyEligible, costRange, attribution }`
- **PlanItem** `{ itemId, homeId, findingId, title, priority, serviceType, costRange, status }`
- **Provider** `{ providerId, name, serviceTypes[], rating, certifications[], serviceZipPrefixes[], availability }`
- **Quote** `{ quoteId, providerId, itemIds[], lineItems[], total, windows[], expiresAt }`
- **Booking** `{ bookingId, quoteId, providerId, windowId, status, confirmationCode, history[] }`

### 9.1 Hazard catalog (initial)
Seed catalog keyed by `spaceType`, each entry with detection cues, an applicability rule over `Profile`, a severity weight, a recommendation, a `diyEligible` flag, a cost range, and an `attribution`.
- **Bathroom:** no grab bars (toilet/tub), high tub threshold, no non-slip surface, poor lighting, no shower chair, scald-risk water temperature, narrow doorway.
- **Kitchen:** out-of-reach storage, poor task lighting, unsafe step stool, loose rugs, hard-to-reach controls.
- **Bedroom:** unlit path to bathroom, no bed support, loose rugs, no nightlight.
- **Stairs/Hall:** missing handrail, uneven/broken steps, no edge contrast, poor lighting, clutter.
- **Entry:** door step, no ramp, uneven walkway, missing handrail, poor lighting.
- **Living:** loose rugs, trip hazards (cords), low seating.

### 9.2 Assessment pipeline
1. **Profile intake** (`update_profile`) — optional but improves severity.
2. **Condition extraction** — Bedrock multimodal converts each image into a validated `Conditions` object per space type; every field is `present | absent | unknown`. Unclear images produce `unknown`, which may trigger a re-capture suggestion.
3. **Rule engine** — deterministic mapping `(spaceType, conditions, profile) → findings[]`, each with `reason` for explainability.
4. **Plan builder** — groups findings into prioritized, costed items and assigns `serviceType`.

The model **never** invents hazards; it only reports what it can see. This satisfies policy §10 and keeps results explainable.

---

## 10. Data Flow

### 10.1 Assessment (happy path)
1. User: "Alexa, check my bathroom for safety problems."
2. Brain → `assess_space(homeId, "bathroom", imageRefs)` → `{ jobId, interim }`.
3. Worker runs condition extraction + rule engine; persists findings.
4. Server pushes `notifications/message` (assessment ready).
5. Brain → `get_assessment(jobId)` → findings rendered as MCP App cards.

### 10.2 Plan → provider → quote → booking
1. "What should I do about it?" → `get_plan(homeId)` → prioritized plan.
2. "Find someone to install a grab bar." → `find_providers("grab_bar_install", zip)`.
3. "Get a quote from the top one." → `request_quote(providerId, itemIds)`.
4. "Book it Tuesday." → `book_service(quoteId, windowId, confirmation=true)` → booking + written confirmation.
5. Later: `get_booking`, `track_home`, `cancel_booking`.

### 10.3 Booking state machine
`requested → quoted → scheduled → confirmed → in_progress → completed`, with `cancelled` reachable from any pre-`completed` state. Legal transitions are enforced by `bookingMachine`; duplicate bookings for the same item/provider/window are rejected.

---

## 11. Authentication & Security

- **Model:** two-tier OAuth 2.1.
  - **Tier 1** `client_credentials` → `mcp:service` scope for `initialize` / `tools/list` / health.
  - **Tier 2** `authorization_code` + **PKCE S256** → `mcp:tools`, `mcp:resources` for user-specific tools.
- **Metadata endpoints:** `/.well-known/oauth-protected-resource` (RFC 9728) and `/.well-known/oauth-authorization-server`.
- **Token endpoint:** `POST /oauth/token`; HTTP Basic client auth; `resource` validated; tokens ≤ 3600 s; no refresh token for client credentials.
- **401 without `WWW-Authenticate`**; no DCR, OIDC, CIMD, or step-up.
- **Dev mode:** `AUTH_MODE=dev` bypass for local development; the demo profile is synthetic.
- **Data:** no unnecessary PII; images and reports scoped per home; tokens never logged.

---

## 12. MCP Apps UI

- One content-hashed bundle with screens selected from the calling tool: **findings**, **plan**, **providers**, **quote**, **booking**, **tracking**.
- Follows the Alexa+ MCP design guide: card/list patterns, container-size breakpoint, ≥48 px targets, host theme variables, safe-area insets, inline + fullscreen, strict CSP (no third-party origins beyond what is declared).
- Buttons call tools through the host bridge and push the result into the model's context for conversation continuity.
- Works voice-only: every screen's information is also available in `content[0].text`.

---

## 13. Agent Brain

- **Primary:** Amazon Bedrock (Claude) via the Converse API with a tool-use loop. The brain calls tools through a **real MCP client** (`StreamableHTTPClientTransport`) — no shortcut into the domain layer.
- **Fallback:** `ruleBrain` intent router driving the same tools when Bedrock is unavailable or unconfigured; the API reports which brain answered.
- **Disclosure:** the simulated client states it is a simulation of Alexa+ (no implication of official affiliation, policy §1).

---

## 14. Simulated Alexa+ Client & Classic Skill

- **Sim client:** Echo-Show-style device frame + a companion panel; browser speech in/out; MCP Apps rendered inline; demo menu to reset/reseed and set local time.
- **Classic Skill:** `POST /alexa` verifies the ASK request signature over the raw body, maps intents to utterances, runs the same brain, and responds with speech + a card/APL screen. This provides a path to demo on Amazon's Alexa simulator or an Echo device with no hardware dependency.

---

## 15. AWS Infrastructure (AWS Builder mini)

AWS CDK (TypeScript) provisions:
- **App Runner** — hosts the MCP server + web app + skill endpoint (`ServiceUrl` feeds `PUBLIC_URL`).
- **DynamoDB** — homes, assessments, findings, providers, quotes, bookings.
- **S3** — assessment images.
- **Secrets Manager** — OAuth client secret, Bedrock config.
- **IAM** — least-privilege Bedrock `InvokeModel` role.
- **Bedrock** — Claude multimodal (vision) + Converse (brain).

Local development requires no AWS account: `AUTH_MODE=dev`, file store, and the rule brain.

---

## 16. Error Handling & UX Requirements

- **No empty responses.** Every tool returns success or a structured error.
- **Actionable messages.** e.g., unclear image → "I couldn't see the shower threshold clearly — could you retake that photo?"
- **No jargon.** No codes, JSON, tool names, or IDs in customer-facing text.
- **State preserved** across mid-flow errors; a single most-likely next step offered.
- **Voice-only** path for all critical flows; ≤5 options; read-back + "yes" before any commitment.
- **Cross-modal consistency:** spoken and on-screen values always match; no stale content.
- **Session expiry** produces a clear "start a new review?" message rather than stale data.

---

## 17. Testing Strategy

- **Unit:** rule engine (each hazard/applicability/severity path), plan builder, provider matcher, booking machine, time/seed.
- **Integration:** every tool over the SDK MCP client; session lifecycle (`initialize` → `tools/list` → `tools/call` → `DELETE`); MCP App resource fetch; auth conformance (tier 1 + tier 2, 401 shape, PRM/auth metadata).
- **Latency:** assert **p95 < 500 ms** per tool via `/metrics.json`.
- **Agent:** smoke test of the five demo beats through `POST /api/agent`, asserting brain + tools used; rule-brain parity tests.
- **E2E:** scripted voice-shaped conversations ("golden beats") with committed transcripts.
- **Conformance:** `scripts/verify-live.mjs` graded probe over the deployed `/mcp` (stand-in for Local Inspector), exiting non-zero on any failure.
- **CI:** GitHub Actions — install, typecheck, lint, test, build on every push.

---

## 18. Project Structure

```
src/
  server/      config, logging, http routes (/mcp, /healthz, /metrics.json, /alexa, /api/agent)
  domain/      model, hazardRules, planBuilder, providerMatcher, bookingMachine, time, seed
  storage/     storage interface, fileStore/sqliteStore, dynamoStore
  mcp/         tools, resources, prompts, schemas, apps registration
  assess/      conditionExtractor (Bedrock vision), worker, conditions schema
  agent/       bedrockBrain, ruleBrain, mcpExecutor, service
  auth/        oauth server, token endpoints, metadata documents
ui/            MCP App bundle (React single-file build → dist/ui/app-<hash>.html)
web/           simulated Alexa+ client (Vite + React + Tailwind, Web Speech)
infra/         AWS CDK (App Runner, DynamoDB, S3, Secrets Manager, IAM)
scripts/       verify-live.mjs, seed, smoke, oauth conformance
addon-package/ addon.json manifest (certification-ready)
docs/          spec, product feedback, friction log, demo script, evidence
test/          vitest suites
```

---

## 19. Delivery Plan

| Milestone | Days | Deliverable | Exit test |
|-----------|------|-------------|-----------|
| **M0** Walking skeleton | 1–3 | Sessionful Streamable HTTP + stdio + CI | lifecycle tests green |
| **M1** Domain core | 4–8 | Rule engine, plan, matcher, booking machine, seed | unit tests green |
| **M2** MCP surface + UI | 9–14 | 10 tools + resources + prompt + MCP App bundle | integration + latency green |
| **M3** Assessment + brain + sim client | 15–19 | Async worker + Bedrock + fallback + web client | 5 demo beats pass |
| **M4** Classic Skill | 20–23 | `/alexa` endpoint | simulator walkthrough |
| **M5** AWS + auth + conformance | 24–27 | CDK deploy + OAuth tiers + probe + metrics | probe exits 0 |
| **M6** Docs + polish | 28–31 | Product feedback, friction log, demo script, README, LICENSE | repo complete |
| **M7** Video + submit | 32–34 | <3 min demo video, submission, collaborators | submitted |

---

## 20. Submission Artifacts

- Public **MIT-licensed** repository (Open Source mini) with run instructions.
- Demo video **under 3 minutes**, public (YouTube/Vimeo), English.
- Product feedback for every tool/API/SDK and AWS service used.
- Track + mini-challenge declaration.
- **Friction log** (bonus).
- Optional feature requests.
- A second, separate open-source contribution (branch/fork/PR) for the Open Source mini.
- Add Amazon reviewers as repo collaborators **at submission time** (invitations expire in 7 days).

---

## 21. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Bedrock access not yet enabled | Medium | Rule brain is a first-class fallback; Bedrock is additive. |
| Vision accuracy too low for a compelling demo | Medium | Curated, high-signal demo photos; rule engine tolerates `unknown`; deterministic seed scenarios. |
| Alexa+ toolkit unavailable | Certain | Simulated client + classic Skill are the primary demo paths; server stays certification-ready. |
| Scope creep beyond 34 days | Medium | Stretch features are explicitly deferred behind M1–M5. |
| Policy rejection on health framing | Low | Observational language + disclaimers + cited sources; no diagnosis/emergency claims. |
| Name is trademarked | Low | Sanity check clean; rename is a single-file change. |
| AWS cost | Low | App Runner scale-to-zero settings; free-tier DynamoDB/S3; documented limits. |

---

## 22. Open Questions

1. **Stretch benefits finder** — include only if M1–M5 finish early (default: defer).
2. **Demo payment depth** — simulated checkout by default; no real processor integration.
3. **Final name clearance** — treat "HearthRail" as working until a formal check is done.

---

## 23. License

MIT. Third-party statistics are attributed, not reproduced.
