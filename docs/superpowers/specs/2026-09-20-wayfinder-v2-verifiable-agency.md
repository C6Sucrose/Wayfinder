# Wayfinder v2 — Verifiable Agency: Design Amendment

**Status:** Proposed amendment to `2026-09-19-wayfinder-design.md` (v1)
**Date:** 2026-09-20
**Supersedes in v1:** §1 Summary, §2 Problem & Impact, §4 Differentiation, §6 Scope, §8.1 MCP surface (tools/resources), §9 Domain Model, §10 Data Flow, §12 MCP Apps UI (screens). Everything else in v1 (architecture, auth, AWS, testing, delivery, submission artifacts) stands.

---

## 1. Why amend

v1 built a competent MCP add-on whose core capabilities are **commodity**: one-shot OCR readback, label reading, object recall, and reminders are all done well by Gemini Live, Google Lens, Seeing AI, and Be My AI, on a device (the phone) that is arguably better suited than an Echo Show for reading.

The commodity critique is correct and accepted. v2 changes the **thesis**, not the architecture:

> Sighted people verify state by looking. A blind person cannot — and is disproportionately targeted by fraud and routinely disbelieved when they assert what a document said. The hard problem is not access to information; it is **auditable, bounded, accountable agency**.

Perception (OCR, labels, scenes) becomes an **input**. The product is the durable, verifiable handler for the paperwork a person cannot glance at.

### 1.1 One-sentence product statement
> Wayfinder remembers every document a blind or low-vision person cannot glance at, correlates them into threads, tracks what is still owed and at risk, acts within limits the user sets, and can **prove** what it did.

---

## 2. The three pillars

Each pillar is load-bearing; removing one breaks the thesis. Abstention protects the **input**; the envelope bounds the **action**; the ledger proves the **output**.

### 2.1 Calibrated abstention — it refuses to act on a document it is unsure it read

**Mechanisms**

1. **Dual-read field consensus.** Two independent reads of the same image:
   - pass A: free-text transcription (existing extractor prompt);
   - pass B: schema-constrained structured field extraction (`sender`, `amount`, `dueDate`, `reference`, `account`).
   The fields derived from pass A are compared against pass B. Any disagreement on a **critical field** (`amount.value`, `dueDate`, `reference`, account tail) marks the document `confidence: "low"`.
2. **Deterministic validity checks** on extracted fields (no model involved):
   - **IBAN mod-97 (ISO 7064)** — an OCR misread of any digit fails the checksum. A claimed IBAN that fails validation is never treated as confirmed.
   - **Date plausibility** — reject dates more than N days in the past or more than 2 years in the future for a *due* date.
   - **Amount sanity** — non-negative, and within a configurable multiple of the sender's historical median (once history exists).
3. **Consequence of low confidence:** the document enters `awaiting_action` with `needsRecapture: true` and a spoken suggestion to re-capture. A low-confidence item is **never auto-acted**; the envelope's `onLowConfidence` policy decides between asking, refusing, or escalating.

**Acceptance criteria**
- A misread IBAN fails `ibanIsValid` and the item is flagged, not acted on.
- A disagreement between pass A and pass B on `amount.value` yields `confidence: "low"` and blocks auto-action.
- All three checks are pure functions with exhaustive unit tests.

### 2.2 Verifiable ledger — a receipt for every decision

**Mechanisms**

1. **Append-only, hash-chained log.** Every event is an entry. `hash = SHA-256(prevHash + "\n" + canonicalJSON(entryWithoutHash))`, where `canonicalJSON` sorts keys and emits no whitespace. The genesis `prevHash` is 64 zeros.
2. **Events:** `ingested`, `triaged`, `action_proposed`, `action_confirmed`, `action_refused`, `delivery_failed`, `superseded`, `flag_raised`, `escalated`, `closed`.
3. **Redaction at write.** `LedgerEntry.details` is passed through `redactSensitive` (v1) **before** hashing, so account numbers never enter the chain in the clear. The chain commits to redacted content, and `export_record` inherits that guarantee.
4. **Verification.** A pure `verifyLedger(entries)` recomputes the chain and returns `{ ok, entries, firstMismatchSeq? }`. It is exposed both as a test helper and as an MCP tool so the agent can prove its own record.
5. **Export.** `buildRecordReport(entries, range)` produces a human-readable, voice-friendly situation report (Markdown) that includes the terminal chain hash, so a caregiver, advocate, bank, or ombudsman can verify it independently.

**Explicit non-claim.** We do **not** claim third-party bank integration or legal evidentiary weight. The honest claim is: *the record is internally consistent and tamper-evident; it can prove what the system saw and did, and that it was not altered afterwards.* Confirmation is "recorded confirmation", and an unconfirmed action past its deadline is **escalated**, not silently assumed.

**Acceptance criteria**
- Tampering with any field of any entry makes `verifyLedger` fail at that sequence number.
- The report's terminal hash equals the last entry's hash and changes if any prior entry changes.

### 2.3 Scoped authority envelope — governance, not vibes

**Mechanisms**

1. **Envelope** (persisted in `Preferences.authority`):
   ```ts
   interface Authority {
     autoActUpTo: { currency: string; value: number };   // e.g. { EUR, 100 }
     confirmAbove: { currency: string; value: number };   // e.g. { EUR, 50 }
     forbidden: Array<"make_payment" | "share_personal_data" | "delete_document" | "discard_document">;
     onLowConfidence: "ask" | "refuse" | "escalate";
   }
   ```
2. **Decision function.** `evaluateAuthority(action, item, envelope) -> { decision: "allow" | "confirm" | "refuse"; reason: string }` — pure and exhaustively tested. Evaluated inside `applyAction` **before** any state change.
3. **Refusals are first-class.** A refusal is spoken with its reason and written to the ledger as `action_refused`. A refused action is not a dead end: the response offers escalation to the trusted contact.

**Acceptance criteria**
- An action above `autoActUpTo` returns `confirm`; the action must not execute until the user confirms.
- A forbidden action type returns `refuse` with a reason; nothing is written to the document, and an `action_refused` entry is appended.
- `onLowConfidence: "escalate"` routes a low-confidence item to the trusted contact and records `escalated`.

---

## 3. Domain model additions

`Item` (v1) is retained and extended; existing fields keep their meaning.

```ts
type Lifecycle = "open" | "awaiting_action" | "action_taken" | "confirmed" | "closed" | "escalated";

interface DocumentRecord extends Item {
  lifecycle: Lifecycle;
  confidence: "high" | "low";
  needsRecapture: boolean;
  demands: Array<{ type: "payment" | "reply" | "appointment"; deadline?: string }>;
  threadKey: string;              // correlation identity (see §4)
  supersedes?: string;            // documentId
  supersededBy?: string;          // documentId
  confirmation?: { at: string; detail: string; artifact?: string };  // recorded, not independently verified
}

interface LedgerEntry {
  seq: number;                    // monotonic, starts at 1
  entryId: string;
  at: string;                     // ISO
  actor: "agent" | "user";
  event: LedgerEvent;
  documentId?: string;
  threadKey?: string;
  details: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

type LedgerEvent =
  | "ingested" | "triaged" | "action_proposed" | "action_confirmed" | "action_refused"
  | "delivery_failed" | "superseded" | "flag_raised" | "escalated" | "closed";

interface Thread {
  threadKey: string;
  sender: string;
  demandType: string;
  documentIds: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  reminderCount: number;          // count of reminder-shaped documents in the thread
  urgency: "low" | "medium" | "high";
  outstanding: boolean;           // any document in the thread not closed/confirmed
}
```

`Item` remains the persisted unit; `DocumentRecord` and `Thread` are derived views computed from items plus the ledger.

**Authoritative state.** `lifecycle` is the authoritative state field. v1's `Item.resolvedAt` is retained only for compatibility and is set to a timestamp **exactly when** `lifecycle` first reaches `closed`; it must never be read to infer lifecycle. Any code that currently branches on `resolvedAt` moves to `lifecycle`.

---

## 4. Correlation rules (deterministic)

Cheap because v1's `extractors.ts` already yields `sender`, `reference`, and `amount`.

1. **Thread identity:** `threadKey = hash(sender || reference || demandType)`; when `reference` is absent, use `sender + demandType`.
2. **Reminders:** a document joining an existing thread whose text matches reminder language (`reminder`, `second reminder`, `final notice`, `overdue`) increments `reminderCount` and raises `urgency`.
3. **Supersession:** supersession language (`replaces`, `correction`, `updated`, `supersedes`) links `supersedes`/`supersededBy` and closes the older document as `superseded`.
4. **Urgency:** `high` if any demand deadline is within 3 days **or** (`reminderCount >= 2` **and** the thread is `outstanding`); `medium` if within 14 days; else `low`.
5. **Duplicates:** identical `reference` + identical demand type within the thread are treated as one demand, not two.

**Known limitation (accepted).** When `reference` is absent, two genuinely different obligations from the same sender with the same demand type (e.g. two unrelated invoices from one utility) will share a thread. This is a deliberate under-merge: conflation is visible and correctable by the user ("no, that's a different one"), whereas over-splitting would hide a real obligation, which is the more dangerous failure for this population. A future extractor signal (invoice number, period) can refine `threadKey` without changing the model.

All five rules are pure functions with unit tests.

---

## 5. MCP surface changes

### 5.1 New tools

| Tool | Purpose |
|---|---|
| `get_backlog` | Threads ranked by urgency, each with outstanding demands, correlated document ids, and why it is urgent |
| `get_audit` | Ledger history for a `documentId` or `threadKey` — answers "what happened with this?" |
| `escalate_item` | Hand an unresolved or refused item to the trusted contact; records `escalated` |
| `verify_ledger` | Runs `verifyLedger` and reports the result and terminal hash |
| `export_record` | Returns a voice-friendly situation report for a period, with the terminal chain hash |

### 5.2 Changed tools

- `act_on_item` — now evaluates the authority envelope first; records `action_proposed` / `action_confirmed` / `action_refused`; advances `lifecycle`.
- `daily_briefing` — becomes a deadline-risk-ordered view over `get_backlog`, not a bare count.
- `capture_scan` / `get_scan` — unchanged externally; internally produce `DocumentRecord`s with confidence and demands.

### 5.3 Resources & UI

- Resources: `wayfinder://ledger`, `wayfinder://inbox`, `wayfinder://objects`, and `wayfinder://capabilities` (see §9.7).
- MCP App screens: **backlog** (threads + urgency + reminder count), **audit/history**, **verification badge** (shows `verify_ledger` result), **refusal** card (reason + escalate affordance).

---

## 6. Demo beats (3 minutes)

1. *"What do I need to deal with?"* → *"Three things. The water bill is the third reminder this month and you haven't acted on the first two — due Friday. The hospital letter supersedes last week's; the appointment moved to the 14th. One letter is a scam: it claims to be your bank, but the sender doesn't match and it asks for gift-card payment."*
2. *"Handle the water bill."* → envelope is consulted (above the confirm threshold) → the user confirms → recorded → **re-read back**: *"Scheduled for Friday, confirmation noted. If it isn't confirmed by Thursday I'll tell Priya."*
3. *"What did I do about the hospital?"* → answered from the ledger.
4. *"Prove it."* → `verify_ledger` → *"14 documents, 9 actions, chain verified. Nothing has been altered."*
5. Scam card → *"Why?"* → explainable reasons.
6. Low-confidence example: a blurred account number → *"I can't read the account number reliably — that one digit fails its check. Re-capture?"*

---

## 7. Compliance & safety (delta)

| Source | Requirement | v2 treatment |
|---|---|---|
| §3 Policy | Minimal data, retention/deletion | Ledger retention is bounded and deletable; `export_record` redacts account numbers. |
| §3 Policy + append-only | **Deletion vs tamper-evidence** | Deleting a document removes its stored content and appends a `closed` entry recording that the content was purged; the chain stays verifiable for everything that remains, and verification reports the purge rather than hiding it. |
| §9 Policy | Attribute factual information | Unchanged; ledger `details` are system facts, not attributed claims. |
| §14 Policy | Financial: no directive advice, explicit confirmation | The envelope **enforces** confirmation thresholds and records confirmations; still no advice and no payment instruments. |
| §10 Policy | Not an LLM relay; real domain value | Strengthened: correlation, checksum validation, hash chain, and the policy engine are all deterministic domain logic. |
| Honesty | No misleading capability claims | "Confirmation" is explicitly defined as *recorded*, and unconfirmed actions escalate. The spec, README, and demo must use that wording. |
| Accessibility | Voice-first | Verification results and refusal reasons are spoken, not screen-only. |

---

## 8. Scope

**In:** the three pillars; lifecycle; correlation; the five new tools; the changed tools; the four screens; the resources (`wayfinder://ledger`, `wayfinder://capabilities`); the six ports with null adapters, the conformance harness, and the three reference adapters (`WebhookNotifier`, `IcsFileSink`, EPC QR `PaymentHandoff`); deterministic tests for every rule, checksum, and adapter contract.

**Now pluggable (previously "out"):** bank/utility connectivity via `DocumentSource` + `PaymentHandoff`; user-owned monitoring via `DocumentSource`; third-party attestation via `SignatureProvider`; human assistance via `AssistProvider`.

**Out — permanently, not for isolation:** payment **execution**; medical or financial **advice**; **emergency-response** claims; reordering/purchases; any adapter we would have to operate on the user's behalf. These are excluded because they move the product into regulated or unsafe territory, not because we want the project isolated.

---

## 9. Extension points (ports & adapters)

**Principle.** Optional services are reached only through small *ports*. Every port ships a **null adapter** that preserves current behaviour exactly, a **conformance harness** every adapter must pass, and a `docs/adapters/<port>.md` recipe. Nothing is enabled by default, nothing is required, and no port may weaken the three pillars. This keeps the core self-contained while letting an operator personalise a deployment — including the two seams that unlock the most value safely (§9.3, §9.4).

### 9.1 The ports

| Port | Null adapter (default = today) | Reference adapter built | Documented recipe only |
|---|---|---|---|
| `Notifier` | ledger + spoken reply | `WebhookNotifier` | SMTP, ntfy, user's own Twilio |
| `CalendarSink` | internal ledger | `IcsFileSink` | CalDAV |
| `PaymentHandoff` | spoken/text instruction + ledger | EPC QR generator | user's banking deep link |
| `SignatureProvider` | local SHA-256 chain | — | AWS KMS sign, RFC 3161 / OpenTimestamps |
| `DocumentSource` | camera / upload | — | IMAP folder, watched directory, inbound webhook |
| `AssistProvider` | none | — | user's Be My Eyes / Aira account |

`Extractor` (vision/OCR) and the agent `Brain` are already ports from v1/Plan 3; this section makes that pattern uniform and documented.

### 9.2 Interfaces

```ts
interface Notifier {
  notify(input: {
    event: LedgerEvent;
    documentId?: string;
    threadKey?: string;
    summary: string;            // already redacted by the caller
  }): Promise<{ delivered: boolean; detail: string }>;
}

interface CalendarSink {
  publish(input: { title: string; start: string; durationMinutes?: number; description?: string }):
    Promise<{ ref: string }>;
}

interface PaymentHandoff {
  // Pure, synchronous, no network. Never executes or initiates a payment.
  prepare(input: {
    amount: { currency: string; value: number };
    beneficiaryName: string;
    iban: string;
    remittance: string;
  }): { instruction: string; epcQr?: string; ledgerNote: string };
}

interface SignatureProvider {
  attest(headHash: string): Promise<{ kind: "local" | "kms" | "tsa"; proof: string }>;
}

interface DocumentSource {
  poll(cursor: string | undefined): Promise<{ imageRefs: string[]; texts: string[]; cursor: string }>;
}

interface AssistProvider {
  request(input: { reason: string; documentId?: string }): Promise<{ sessionRef: string }>;
}
```

### 9.3 `PaymentHandoff` — the honest answer to "connect my bank"

We never execute a payment, hold credentials, or give financial advice (§14). Instead `prepare` returns a spoken instruction plus an **EPC069-12 (SEPA) QR payload**. The user scans it **in their own banking app**, which performs the transfer. The generator is a pure function — fully unit-testable — and the ledger records that a handoff was produced, not that money moved.

Required: `epcQr` encodes exactly `BCD`, version, UTF-8, `SCT`, optional BIC, beneficiary name, IBAN, amount (`EUR12.50`), optional purpose, remittance, and a **CRC16-CCITT (0x1021) checksum over the payload including its trailing newline**, uppercase hex. An invalid IBAN (per §2.1) must refuse to generate a payload.

### 9.4 `SignatureProvider` — attestation becomes pluggable

The local hash chain remains the default and still verifies offline. An operator may layer an external attestation (KMS asymmetric signature, RFC 3161 timestamp, OpenTimestamps). `attest(headHash)` returns the proof, which is stored with the ledger head and shown by `verify_ledger` as `{ kind, proof }`. The spec, UI, and demo must state precisely what was attested — a hash and a time — and must not claim legal or evidentiary weight.

### 9.5 `DocumentSource` — safe "monitoring"

A user-owned channel (their mailbox, their watched folder, their inbound webhook) may deliver documents into the same pipeline as camera capture. This is the only permitted form of monitoring: user-consented, user-owned, and with no claim of real-time surveillance or emergency detection.

### 9.6 Adapter rules (binding)

1. **Disabled by default.** An adapter is inert unless explicitly configured via environment (`WAYFINDER_ADAPTER_<PORT>`) or `Preferences.adapters`. The null adapter is the default in every code path and test.
2. **Never in the request path.** Adapters that touch the network (`Notifier`, `CalendarSink`, external `SignatureProvider`, `AssistProvider`, `DocumentSource` polling) run in the worker or after the tool response. The **< 500 ms tool-handler budget is inviolable**.
3. **Redact before transmit.** Payloads pass through `redactSensitive` (v1) before leaving the process.
4. **HTTPS only, exact-URL allowlist, hard timeout (5 s), and idempotency.** A notification carries the originating `entryId` so a retry cannot double-notify.
5. **Secrets** come from the environment or AWS Secrets Manager; they are never logged and never written to the ledger.
6. **Failures are visible.** A delivery failure appends a `delivery_failed` ledger event and is spoken; it is never silent.
7. **Conformance.** Each port has a contract suite (`test/adapters/contract.ts`); `scripts/adapters-conformance.mjs` runs every configured adapter against it and exits non-zero on failure.

### 9.7 Capability disclosure

The system reports what is actually wired, never what is merely possible:
- MCP resource `wayfinder://capabilities` and HTTP `GET /capabilities` return `{ adapters: { notifier: "webhook" | "null", … }, chain: { head, verified } }`.
- The ledger records an entry whenever an external service is invoked.

### 9.8 The permanent line

Independently of ports, these are **never** shipped, not even as seams: payment **execution**, medical or financial **advice**, and **emergency-response** capability. `PaymentHandoff` produces instructions; it never moves money.

**Acceptance criteria**
- With no adapters configured, behaviour and the full test suite are unchanged from v2's non-adapter state.
- An invalid IBAN cannot produce an `epcQr` payload.
- `epcQr` output round-trips through an independent CRC16 check.
- A configured `WebhookNotifier` is invoked only off the request path, with a redacted payload, and a forced failure produces a `delivery_failed` entry.
- `/capabilities` reports `null` for every unconfigured port.

---

## 10. Risks


| Risk | Mitigation |
|---|---|
| Dual-read consensus needs Bedrock to demo live | Unit-test with injected extractors; the deterministic checks (mod-97, dates) work without Bedrock. |
| Perceived as feature creep | The three pillars all serve one sentence; the spec says so explicitly. |
| Hash chain seen as theatre | It is cheap, standard, and directly answers the "cannot verify / disbelieved" thesis; `verify_ledger` makes it demonstrable. |
| Overclaiming confirmation | Explicit non-claim section; enforced wording. |
| Schedule pressure | Added work pushes Skill/AWS/submission later; deadline is 2026-10-23. |
