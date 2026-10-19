# Submission

## Declaration

**Project:** Wayfinder — verifiable agency for the paperwork you can't glance at.

**Primary track:** Alexa+
**Mini-challenges:** AWS Builder · Open Source

**Deadline:** 2026-10-23

## One-paragraph summary

Wayfinder is a voice-first MCP server for blind and low-vision adults. It remembers every document a person cannot glance at, correlates them into threads, tracks what is still owed and at risk, acts only within limits the user sets, and keeps a tamper-evident ledger it can use to prove what it did. Perception is the input; auditable, bounded, accountable agency is the product. It runs offline by default, and it is provider-agnostic: `rules`, a hosted model of your choice, or Bedrock, with Amazon Textract for document vision.

## Required technology

| Requirement | Status |
|---|---|
| Self-hosted MCP server | ✅ `/mcp`, sessionful Streamable HTTP |
| MCP spec `2025-11-25` or later | ✅ `@modelcontextprotocol/sdk` 1.30.0, `LATEST_PROTOCOL_VERSION = 2025-11-25` |
| MCP Apps UI | ✅ one View, `ui://wayfinder/app.html`, rendered through the App Bridge |
| Voice-first | ✅ host speech in/out; every result also spoken |

## Artifact checklist

| Artifact | Status | Where |
|---|---|---|
| Public MIT repository | ✅ | repository root; `LICENSE` |
| Run instructions | ✅ | [`README.md`](../README.md) quick start |
| Interactive documentation | ✅ | [`docs/index.html`](index.html) |
| Demo video, under 3 minutes, public, English | ⬜ | link to be added here |
| Product feedback for every tool/API/SDK and AWS service used | ✅ | [`docs/feedback/`](feedback/) |
| Track + mini-challenge declaration | ✅ | this file |
| Friction log (bonus) | ✅ | [`docs/friction-log.md`](friction-log.md) |
| Second open-source contribution (Open Source mini) | ⬜ | to be linked |
| Amazon reviewers added as collaborators at submission | ⬜ | repository settings; invites expire in 7 days |

## How to run it

```bash
npm install
npm run build
npm start          # MCP server on http://127.0.0.1:8080

npm run dev:web    # demo host on http://127.0.0.1:5173
```

No cloud credentials are required. With no provider configured the deterministic rule brain runs, and vision is off.

With a hosted brain:

```bash
WAYFINDER_PROVIDER=google
GEMINI_API_KEY=...
WAYFINDER_MODEL=...
WAYFINDER_VISION=textract
```

With Bedrock (currently gated by AWS account verification):

```bash
BEDROCK_MODEL_ID=...
AWS_REGION=us-east-1
```

## What is real, and what is not

This matters more than the feature list.

**Implemented and tested**

- MCP tools, resources, prompts and the App View.
- Correlation, the authority envelope, and the hash-chained ledger.
- Offline rule brain; provider layer with 16 presets.
- Amazon Textract document extraction.
- Accessible screens: backlog, audit history, verification, refusal.
- Adapter ports (notifier, calendar, payment handoff) with null defaults and a conformance harness.

**Alexa skill**

A classic Alexa Skill host is implemented at `POST /alexa`, with ASK request-signature verification, intent routing into the existing brain, and SSML, Simple card, and APL responses. The manifest, interaction model, sample request, and setup guide are in [`docs/alexa/`](alexa/README.md). Unit tests cover verification and response shapes. Registering and certifying the skill in an Amazon developer account is the operator's step; it is not included here.

**Implemented but currently blocked externally**

- **Amazon Bedrock** inference: the code is complete, but this account's per-model daily token quota is `0` and the account is under verification. See [`docs/feedback/aws.md`](feedback/aws.md).

**Not implemented (stated plainly)**

- Native Anthropic and Bedrock `ChatProvider` adapters; Anthropic is reachable via `openrouter`, Bedrock via its legacy path.
- `WAYFINDER_VISION=provider` (multimodal provider reading).
- Payment execution, medical or financial advice, and emergency response — excluded permanently by design, not by omission.

## The honest claim

The ledger is internally consistent and tamper-evident. It proves what the system saw and did, and that it was not altered afterwards. It is not third-party bank integration and it is not legal evidence. "Confirmation" means *recorded confirmation*, and an unconfirmed action past its deadline is escalated, never silently assumed.

## Reviewer access

Add the designated Amazon reviewers as collaborators at submission time. Note: collaborator invitations expire after seven days, so invite as late as the process allows.
