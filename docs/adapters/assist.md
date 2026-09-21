# Assist

Purpose: escalate an unclear or sensitive case to the user's own assistance service.

Default (null adapter): `nullAssist` returns `{ sessionRef: "none" }`; nothing leaves the process.

Enable (recipe only): there is no wired adapter yet. `WAYFINDER_ADAPTER_ASSIST` is reserved for a
future user-owned assistance service. No such adapter is implemented in this release and no
environment is read.

Required environment (future recipe): the service URL, credentials supplied only through the
environment, and a callback or session convention.

Rules: the service must be the user's own; HTTPS with an exact-URL allowlist and a bounded timeout;
onward payloads are redacted; a request keyed by case id is idempotent so a retry cannot open two
sessions; failures fall back to the null adapter rather than blocking the request path.

Verify: `npm run adapters:conformance`
