# Payment

Purpose: hand a payment instruction to the user so they can pay it themselves.

Default (null adapter): a spoken instruction only; no payload is built and no payment is made.

Enable (EPC QR):
- `WAYFINDER_ADAPTER_PAYMENT=epc`

You can also select the adapter through `Preferences.adapters.payment = "epc"`; the environment
variable wins when both are set. No other environment is required.

Required environment: none.

Rules: the system never executes a payment; it builds an EPC069-12 payload with a CRC16-CCITT
checksum and the user scans it in their own banking app. An invalid IBAN refuses the handoff (no
`epcQr` is produced). HTTPS, allowlist, timeout, and idempotency do not apply because nothing is
transmitted; redaction still applies to the spoken instruction and ledger note.

Verify: `npm run adapters:conformance`
