# DocumentSource

Purpose: poll a channel the user owns for new documents (images and text) and return a cursor.

Default (null adapter): `nullDocumentSource` returns no image refs, no texts, and keeps the cursor
stable (`cursor ?? "0"`); nothing leaves the process.

Enable (recipe only): there is no wired adapter yet. `WAYFINDER_ADAPTER_DOCUMENTSOURCE` is reserved
for a future user-owned channel (for example a mailbox or shared folder). No such adapter is
implemented in this release and no environment is read.

Required environment (future recipe): the channel URL or directory, credentials supplied only through
the environment, and an initial cursor.

Rules: the channel must be user-owned and read-only to Wayfinder; HTTPS with an exact-URL allowlist
and a bounded timeout for any remote channel; fetch only after the cursor; redact before anything is
stored or transmitted; a repeated poll at the same cursor must not re-import the same document.

Verify: `npm run adapters:conformance`
