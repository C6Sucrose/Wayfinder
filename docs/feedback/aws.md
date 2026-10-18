# AWS feedback

Services used: **Amazon Bedrock (Bedrock Runtime, Converse)**, **Amazon Textract**, **Amazon Rekognition** (evaluated), **IAM / STS**, **Service Quotas**, **AWS Support**.

---

## Amazon Bedrock — Bedrock Runtime, Converse API

**Used for** the language brain (tool-use loop) and image reading (multimodal input). One `ConverseCommand` call shape covers text, tools, and images, which was a genuine simplification: the same client served the brain and the extractor.

**Severity: Blocker.**

### What worked

- A single `Converse` request shape for text, tool use, and image blocks. Model-agnostic by construction — swapping the model id is the only change.
- Tool definitions (`toolConfig.tools[].toolSpec.inputSchema.json`) mapped cleanly onto our MCP tool schemas; the tool-use loop needed no Bedrock-specific branching beyond content block shapes.
- Cross-region inference profiles are discoverable via `list-inference-profiles` and behave as documented.

### What was hard

1. **The blocking quota is not the one the console surfaces.** Our requested quota was *tokens per minute* (cross-region inference). Every candidate model was effectively unusable with `ThrottlingException: Too many tokens per day`. The actual gate is a separate per-model quota, *Model invocation max tokens per day*, which read `0`. Nothing in the error says which quota to look at.
2. **The same quota code reports different values by region.** In one region the per-model daily quota read `0`; in two others it read `720,000,000`; a fourth returned `AccessDeniedException: Your account is currently being verified`. Re-reading the same region minutes later returned a different value again. That makes any client-side capacity logic unreliable.
3. **There is no API for account-verification state.** The only signal is an `AccessDeniedException` message in one region and `ThrottlingException` in others. `Support.DescribeCases` requires a Premium Support subscription, so we could not read our own case status programmatically.
4. **Two support replies contradicted each other.** One said the request could not be processed and closed the case as "no further action required"; a later reply said the same request was under active review. The Service Quotas history then showed the two sibling requests in different states (`CASE_CLOSED` and `CASE_OPENED`).
5. **"Ramp up your usage" is circular.** The guidance was to build usage history before a quota increase, but the per-model daily quota being `0` prevents any usage that would build that history.
6. **Error messages do not name the model or the quota.** `Too many tokens per day` with no model id or quota code makes triage guesswork across 27 per-model quotas.

### Suggestions

- Return the quota code and the current limit in `ThrottlingException` messages (e.g. "quota L-… is 0 for model X").
- Expose account-verification state through a documented API, and let `ServiceQuotas` / `Support` read case status without Premium Support.
- Surface the per-model **daily** quota next to the **per-minute** quota in the console and in `get-service-quota` output.
- Make quota values region-consistent, or document why they are not.
- Accept a `null`/absent daily quota as "inherit the account-level budget" rather than as `0`.

---

## Amazon Textract — `DetectDocumentText`

**Used for** reading documents (bills, letters) behind our `Extractor` port. Verified working on this account with a **25 TPS** `DetectDocumentText` limit.

**Severity: Low–Medium (the best experience in this project).**

### What worked

- Returned `PAGE` / `LINE` / `WORD` blocks with per-word `Confidence` — exactly the structure a confidence-based abstention design needs.
- Byte upload avoided any S3 round trip for our size of document.
- Stable, predictable errors (`UnsupportedDocumentException`, `InvalidImageFormatException`) that name the problem.

### What was hard

- **Synchronous limits are easy to miss**: 5 MiB and JPEG/PNG/PDF/TIFF. Our image loader supports WebP and GIF, so we had to add an explicit format gate and a clear error rather than let Textract reject it. This is documentation, not a defect, but it cost a debugging cycle.
- The typed SDK block shape is broad (`BlockType` is a string union with many members), so we narrowed it ourselves.
- Per-word confidence is returned but not surfaced in a convenient aggregate; we sum it ourselves.

### Suggestions

- State the synchronous size/format limits in the method docs, not only the service limits page.
- Consider accepting WebP (widely used by phone cameras) or returning a single typed "unsupported format" error type.
- Provide a typed helper for "lines in page order" — it is the common document workflow.

---

## Amazon Rekognition — `DetectLabels` / `DetectText`

**Used for** an evaluation of an alternative reader. `DetectLabels` worked immediately with a generated PNG; `DetectText` returned an empty result for an image with no text (correct).

**Severity: Low.**

- Worked as documented with byte upload.
- Not chosen as the primary reader because Textract returns document-oriented `LINE` blocks with confidence, which fits our domain better. That is a product fit, not a service complaint.

---

## IAM and STS

**Used for** credentials and identity checks during setup.

**Severity: Low.**

- `sts get-caller-identity` is the clearest first check; we used it repeatedly.
- **Feedback:** the interactive session expired three times in a working day, each requiring a re-login before any quota or Bedrock call. For iterative work, short-lived default sessions are the single biggest papercut in the AWS workflow. A documented, long-lived development profile (scoped to `bedrock:InvokeModel`, `textract:DetectDocumentText`, `servicequotas:Get*`, `servicequotas:List*`) would help.
- We tested as the root identity, which is not what we would deploy. The product's README now points at scoped credentials.

**Suggestion:** ship a copy-pasteable least-privilege policy for Bedrock + Textract + quota reads in the Bedrock/Textract docs.

---

## Service Quotas

**Used for** checking limits and the state of two increase requests.

**Severity: High (discoverability).**

### What worked

- `list-requested-service-quota-change-history` is excellent: it gives status, desired value, and timestamps in one call.
- `get-service-quota` and `list-service-quotas` made the per-model quotas auditable.

### What was hard

- The service exposes **dozens** of per-model quotas, and the names are long (`Model invocation max tokens per day for … (doubled for cross-region calls)`). Finding the relevant one requires client-side filtering.
- The distinction between *tokens per minute*, *tokens per day*, and *cross-model account-level tokens per day* is not explained next to the values.
- Quota values changed between reads with no indication of why.

**Suggestion:** add a "effective limit for a model" endpoint that returns the min of all applicable quotas, and annotate each value with the scope (per model / per account / per region).

---

## AWS Support

**Used for** the two quota requests.

**Severity: High.**

- Humans were polite and responsive; the first reply explained the policy clearly.
- But the case state was not readable without Premium Support, and the two replies disagreed about whether the request was still open.
- The guidance ("contact your account manager or sales") is not available to an account without one.

**Suggestion:** expose case status to `ServiceQuotas` (it already tracks the request), and keep a single authoritative status per request.

---

## What we would do differently

- Read the **per-model daily** quota before requesting a TPM increase.
- Verify model access with one tiny `Converse` call per region rather than trusting quota metadata.
- Prefer **Textract** for documents from the start; an LLM read is not the right tool for line-accurate extraction with confidence.
- Keep a provider-agnostic seam so a quota wall cannot stop the product (this is now implemented).
