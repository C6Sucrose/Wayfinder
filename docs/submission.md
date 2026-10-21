# Wayfinder — submission overview

**Primary track:** Alexa+

**Mini-challenge:** AWS Builder

**Repository:** https://github.com/C6Sucrose/Wayfinder

**License:** MIT

Wayfinder is a voice-first assistant for blind and low-vision people that connects
related paperwork, ranks outstanding demands, checks every action against
user-defined limits, and maintains a tamper-evident record of system decisions.

## Demonstration and evaluation

- [2:43 demonstration video](video/Wayfinder-submission.mp4), with English narration
  and [captions](video/Wayfinder-captions.srt).
- [Screenshot gallery](gallery/README.md).
- [Setup and judge walkthrough](../README.md#judge-walkthrough).
- [Interactive product documentation](index.html).

The video shows the running web MCP host with fictional sample data, offline rules,
and image reading disabled. Local evaluation requires Node.js 22 or newer and no
application login, API key, AWS account, or Alexa hardware. New image extraction
requires a configured vision service. The demonstration host is not an Alexa device.

## Required technology

- Self-hosted MCP server at `/mcp`, using sessionful Streamable HTTP and protocol
  version `2025-11-25`.
- MCP tools, resources, and prompts, plus interactive MCP App views rendered
  through the App Bridge.
- Browser host with voice input, speech output, and matching interactive screens.

## AWS integration

**Amazon Textract:** The configured reader calls `DetectDocumentText` through the
AWS SDK and reconstructs document lines from JPEG/PNG bytes. This integration was
exercised on the development account.

**Amazon Bedrock:** Optional agent tool orchestration and multimodal extraction
use Bedrock Runtime's `Converse` API. Live inference was blocked during development
by account verification and an effective per-model daily token quota of zero.

Implementation: [Textract client](../src/scan/textractClient.ts),
[Textract extractor](../src/scan/textractExtractor.ts),
[Bedrock brain](../src/agent/bedrockBrain.ts), and
[Bedrock extractor](../src/scan/bedrockExtractor.ts).

Detailed [product feedback](feedback/README.md) and the [friction log](friction-log.md)
describe the integrations and development experience.

## Implemented capabilities and limitations

Document correlation, urgency ranking, authority checks, hash-chained ledger
verification, offline routing, the OpenAI-compatible provider adapter, and
accessible MCP App screens are implemented and tested.

A classic [Alexa Skill endpoint](alexa/README.md) routes intents to the same core
and returns SSML, cards, and APL responses. Request verification and response
shapes are tested locally. Amazon account registration and certification are
separate deployment steps.

Native Anthropic and Bedrock `ChatProvider` adapters and
`WAYFINDER_VISION=provider` are **not implemented** in this release. Bedrock has a
separate legacy integration; Anthropic models can be reached through OpenRouter.

The ledger is internally consistent and tamper-evident. **Recorded confirmation**
means the system recorded the user's confirmation, not that a bank independently
verified it. It is **not legal evidence**. Payment handoffs prepare instructions
for the user's banking app; Wayfinder never executes payments.

No additional contribution is claimed here for the **Open Source** mini-challenge.

## Verification

The final repository checks passed on 2026-10-21: build, type checks, lint,
578 tests across 66 Vitest files, adapter conformance, seeded-data preflight,
and the end-to-end demo smoke check. The archived video is 163.27 seconds,
1080p, H.264/AAC, with English captions.
