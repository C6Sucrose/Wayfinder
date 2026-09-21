# Signature

Purpose: attest the head hash of the ledger so tampering is detectable.

Default (local adapter): `localSignature` returns `{ kind: "local", proof: headHash }`; the proof is the
head hash itself and the hash chain is the source of truth. Nothing leaves the process.

Enable: the local adapter is always on; there is no environment toggle.

Required environment: none for the local adapter.

KMS/TSA (documented only): an external attestation provider (`kind: "kms"` or `kind: "tsa"`) is not
implemented. If added, the recipe would require `WAYFINDER_ADAPTER_SIGNATURE=kms|tsa`, a key or
endpoint identifier from the environment, HTTPS with an exact-URL allowlist, a bounded timeout, and a
proof stored alongside the head hash. Secrets are read from the environment only.

Rules: the default never transmits; the hash chain is verifiable offline. Any future external
provider must be HTTPS, allowlisted, time-bounded, redacted, and idempotent before it ships.

Verify: `npm run adapters:conformance`
