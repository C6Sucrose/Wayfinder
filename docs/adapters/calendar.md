# Calendar

Purpose: publish a calendar event when the system records a dated commitment.

Default (null adapter): events stay in the ledger as an internal ref (`ledger:<title>`); no file leaves
the process.

Enable (ICS directory):
- `WAYFINDER_ADAPTER_CALENDAR=ics`
- `WAYFINDER_ICS_DIR=/path/to/user/calendars` (a directory the user owns)

You can also select the adapter through `Preferences.adapters.calendar = "ics"`; the environment
variable wins when both are set. The directory still comes from `WAYFINDER_ICS_DIR`.

Required environment: `WAYFINDER_ICS_DIR`, writable by the process.

Rules: writes only under the configured directory; each event is a self-contained `.ics` file with a
random UID so a retry cannot overwrite an existing event; no network access; no secrets in the event
text. HTTPS, allowlist, and timeout do not apply because delivery is local; redaction still applies.

Verify: `npm run adapters:conformance` (validates wiring and the offline calendar contract against a
temporary directory; it never writes to your configured calendar directory).
