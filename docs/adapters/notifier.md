# Notifier

Purpose: deliver a redacted notification when the system records an event.

Default (null adapter): nothing leaves the process; the ledger and spoken reply are the notification.

Enable (webhook):
- `WAYFINDER_ADAPTER_NOTIFIER=webhook`
- `WAYFINDER_WEBHOOK_URL=https://...` (must be https and exactly listed)
- `WAYFINDER_WEBHOOK_ALLOWLIST=https://...,https://...`
- `WAYFINDER_ADAPTER_TIMEOUT_MS=5000` (optional)

You can also select the adapter through `Preferences.adapters.notifier = "webhook"`; the environment
variable wins when both are set. The URL, allowlist, and timeout still come from the environment.

Rules: HTTPS only; exact-URL allowlist; 5 s timeout; payloads redacted; delivery keyed by `entryId` so
retries cannot double-notify; failures append `delivery_failed`.

Verify: `npm run adapters:conformance` (validates wiring and the offline notifier contract with a stub
fetch; it never performs a live delivery).
