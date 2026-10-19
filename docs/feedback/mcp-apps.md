# MCP Apps feedback

**Package:** `@modelcontextprotocol/ext-apps` **1.7.5**.

**Used for** serving one interactive View (`ui://wayfinder/app.html`) and rendering it in a host through the App Bridge.

**Severity: Medium.**

## What worked

- **One resource, many screens.** `registerAppTool` with `_meta.ui.resourceUri` plus a single `registerAppResource` was a clean model: the host mounts the View, the View switches on `toolInfo.tool.name`.
- **Host context theming.** `app.onhostcontextchanged` plus `styles.variables` let the View honour the host's colours and fonts; we also pass a `textSize` field through the same channel for large-text support.
- **`sendSizeChanged`** and the host's `onsizechange` make the iframe size itself correctly.
- **The sandbox is real.** The View runs in a sandboxed iframe without same-origin, which is the right default and materially improves security.

## What was hard

1. **The sandbox blocks the microphone — by design — and that should be stated loudly.** For a voice-first product this is the single most important architectural fact: speech capture, audio analysis, and level metering can never live in the View. We had to move all of it into the host. A one-paragraph "what the sandbox forbids" section would save a design rewrite.
2. **`AppBridge.close()` does not exist** (or is not typed), even though "close" is the obvious verb. The correct teardown is `teardownResource({})`. We hit this as a compile error after enabling stricter type-checking.
3. **Type exports are awkward.** Importing `McpUiHostCapabilities` from `@modelcontextprotocol/ext-apps/app-bridge` produced `TS2460: declares locally but is exported as …`; the root entry produced a similar error. We dropped the annotation and let inference do it. A single, unambiguous export surface for the UI types would help.
4. **Host-context typing is loose.** `McpUiHostContext` allows arbitrary keys, which is pragmatic for forward compatibility but means custom fields (like our `textSize`) are untyped at both ends.
5. **The size-change loop needs care.** A `ResizeObserver` posting `sendSizeChanged` on every frame can feed back into layout; we budget for it deliberately.

## Suggestions

- Document explicitly which capabilities the sandbox withholds (microphone, camera, storage, same-origin), and the recommended host-side workaround for each.
- Make `teardownResource` the documented counterpart to `connect`, and mention that `close` is not part of the bridge.
- Export the `McpUi*` types from a single path that type-checks under `verbatimModuleSyntax`/`isolatedModules`.
- Provide a typed escape hatch for host-context extensions (e.g. a generic parameter).
- Publish a minimal "voice-first app" example showing speech in the host, data in the View.

## What we did

- All microphone, speech, and audio work lives in the host (`web/`); the View is presentation only.
- Teardown uses `teardownResource({})`.
- The View reads theme and text size from host context and degrades gracefully when absent.
