# Wayfinder Alexa skill

## What this is

This directory holds the artifacts for a classic Alexa Skill host. The skill registers `POST /alexa` on the same Wayfinder server that exposes the MCP surface, and it calls the same brain. It does not fork behavior: intents are routed into the existing agent and answered with SSML. Agent-backed answers also include a Simple card, and devices that advertise APL support get a minimal APL document.

The invocation name is `wayfinder` and the published skill name is `Wayfinder`.

## Prerequisites

- An Amazon developer account.
- A public HTTPS endpoint that serves this Wayfinder server, reachable by Alexa.
- The skill enabled for your own developer account so you can test it in the console.

Nothing here registers the skill for you. Publishing and certification happen in your Amazon developer account.

Before you upload the manifest, set `apis.custom.endpoint.uri` to your public HTTPS deployment.

## Steps

1. Create a custom skill in the Alexa developer console.
2. Upload [`skill.json`](skill.json) as the skill manifest.
3. Upload [`interaction-model.json`](interaction-model.json) as the interaction model.
4. Set `apis.custom.endpoint.uri` to `https://YOUR_HOST/alexa`, replacing `YOUR_HOST` with your deployment.
5. Enable the APL interface (`ALEXA_PRESENTATION_APL`), which the manifest requests.
6. Build the interaction model.
7. Test in the developer console (the simulator, or the test tab) once the endpoint is reachable.

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `WAYFINDER_ALEXA` | `on` | `off` disables the endpoint entirely; no `/alexa` route is mounted. |
| `WAYFINDER_ALEXA_VERIFY` | `on` | `off` disables ASK request-signature checks. **Local testing only.** The timestamp freshness check still runs. |
| `WAYFINDER_ALEXA_APP_ID` | unset | When set, requests whose `session.application.applicationId` does not match exactly are rejected with `401`. |

**Never set `WAYFINDER_ALEXA_VERIFY=off` on a public endpoint.** With verification off, anyone who can reach the URL can drive the skill and the brain behind it. The bypass exists only so a developer can exercise the handler without Amazon's signed request.

When `WAYFINDER_ALEXA_APP_ID` is unset, any application id is accepted. That is a deployment assumption: set it to your skill id in any shared environment.

## Local testing

The timestamp in [`sample-request.json`](sample-request.json) is a placeholder from the past. It is only a shape reference, not a fresh request, and the endpoint rejects it. Set the timestamp to the current time before posting. Start the server with the bypass:

```bash
WAYFINDER_ALEXA_VERIFY=off npm start
```

Then post a request with a fresh timestamp. PowerShell:

```powershell
$body = Get-Content docs/alexa/sample-request.json -Raw | ConvertFrom-Json
$body.request.timestamp = (Get-Date).ToUniversalTime().ToString("o")
Invoke-WebRequest -Method Post -Uri http://127.0.0.1:8080/alexa `
  -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 10)
```

bash:

```bash
curl -i http://127.0.0.1:8080/alexa \
  -H "Content-Type: application/json" \
  --data-binary "$(sed "s/\"2026-10-17T10:00:00Z\"/\"$(date -u +%FT%TZ)\"/" docs/alexa/sample-request.json)"
```

The sample sends a `BacklogIntent`. Without the bypass, the same request has no valid ASK headers, so the endpoint rejects it with `401 Unauthorized`. That rejection is the correct behavior: the signature check is what makes the endpoint safe to expose.

## Honest limits

- We could not test against Amazon's simulator from this environment. The artifacts and endpoint were built and exercised locally.
- Request and response shapes are unit-tested, including signature verification, intent routing, SSML/card/APL construction, and session handling.
- Root-CA pinning is **not** implemented. Verification relies on TLS to `s3.amazonaws.com`, the SAN check on the fetched certificate, certificate validity dates, and the RSA signature over the request body (with a separate timestamp freshness check).
- The skill adds no capabilities beyond what MCP already exposes. It is a transport and presentation layer, not a new set of actions.
- Registration, enablement, and certification remain the operator's steps in the Amazon developer account.
