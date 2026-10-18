# Product feedback

This is the feedback we owe the hackathon: what we used, what worked, and what made the work harder. It is written from the actual build, not from documentation. Every entry names the specific behaviour we hit and a concrete suggestion.

## Method

We built Wayfinder — a voice-first MCP server with a tamper-evident ledger — end to end on this stack. Feedback was recorded while building: each time a tool, API, SDK, or AWS service cost us time or shaped a design decision, it went into the working notes that became this directory. Versions below are the ones actually installed.

Screenshots, logs, and case identifiers are deliberately omitted; the account is not a public artifact.

## Versions used

| Package / service | Version |
|---|---|
| `@modelcontextprotocol/sdk` | 1.30.0 (protocol `2025-11-25`) |
| `@modelcontextprotocol/ext-apps` | 1.7.5 |
| `@aws-sdk/client-bedrock-runtime` | 3.1136.0 |
| `@aws-sdk/client-textract` | current |
| `express` | 4.22.3 |
| `zod` | 3.25.76 |
| `typescript` | 5.9.3 |
| `vitest` | 2.1.9 |
| `esbuild` | 0.25.12 |
| `vite` | 6.4.3 |
| `eslint` | 9.39.5 |
| `prettier` | 3.9.8 |
| Node.js | 22+ |

## Severity scale

- **Blocker** — stopped the work until we changed approach.
- **High** — cost hours or forced an architectural decision.
- **Medium** — cost a focused debugging session.
- **Low** — papercut.

## Entries

| Area | Entry | Worst severity |
|---|---|---|
| AWS | [Bedrock, Textract, Rekognition, quotas, support](aws.md) | Blocker |
| MCP | [`@modelcontextprotocol/sdk`](mcp-sdk.md) | Medium |
| MCP Apps | [`@modelcontextprotocol/ext-apps`](mcp-apps.md) | Medium |
| Web platform | [Microphone, speech, audio, observers](web-platform.md) | High |
| Tooling | [TypeScript, esbuild, Vite, Vitest, ESLint](tooling.md) | Low |

## Summary of the five things that mattered most

1. **Bedrock's per-model daily token quota is the real gate, and it is invisible.** The console-level "tokens per minute" quota reads `0`, but the rejection is `ThrottlingException: Too many tokens per day` — a different quota. See [aws.md](aws.md).
2. **The same quota behaves differently per region.** One region reported `0`, two reported hundreds of millions, and one returned "your account is currently being verified". There is no API to read that verification state.
3. **The MCP Apps sandbox correctly blocks the microphone**, which forced voice capture into the host — the right architecture, but it should be stated loudly for voice-first products. See [mcp-apps.md](mcp-apps.md).
4. **`SpeechRecognition` and `getUserMedia` are separate microphones.** There is no supported way to get the audio stream behind speech recognition, so a level meter needs a second capture. See [web-platform.md](web-platform.md).
5. **`exactOptionalPropertyTypes` is worth it but needs examples.** Conditional spreads everywhere; one line in the docs would have saved repeated searches. See [tooling.md](tooling.md).
