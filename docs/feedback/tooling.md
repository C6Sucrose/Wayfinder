# Tooling feedback

Tooling used: **TypeScript 5.9.3**, **esbuild 0.25.12**, **Vite 6.4.3**, **Vitest 2.1.9**, **ESLint 9.39.5**, **Prettier 3.9.8**, **Node.js 22+**, **npm**.

**Severity: Low.**

## What worked

- **esbuild** builds the MCP App View into one self-contained HTML file in well under a second. Inlining the stylesheet and bundling to IIFE is exactly right for a sandboxed View.
- **Vitest** is fast and the `InMemoryTransport` integration tests run in-process. `pretest` building the UI bundle keeps the bundle test honest.
- **Zod** raw shapes map directly onto MCP tool schemas, so one definition serves validation and protocol.
- **ESLint 9 flat config** was a one-file setup and caught real issues (unused imports, `any`).
- **TypeScript strictness** (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) prevented several real bugs, especially around optional host-context fields.

## What was hard

1. **`exactOptionalPropertyTypes` needs a cookbook.** Every conditional field becomes a spread (`...(x !== undefined ? { x } : {})`). It is the right setting, but the error messages do not suggest the pattern.
2. **ESM requires `.js` suffixes on relative imports** even from `.ts` files, and both `tsc` and esbuild must agree. One missing suffix is a runtime failure, not a type error, unless the config is right.
3. **Multiple surfaces need multiple tsconfigs.** The Node server, the UI bundle, and the browser client have different libs (no DOM vs DOM). We ended up with three tsconfigs and a `typecheck` script that runs them in sequence — necessary, but a common source of "why isn't this checked?".
4. **The browser client was untyped for a while** because only the server config existed; adding `web/tsconfig.json` surfaced two genuine bugs (a narrowed return type and a call to a non-existent method).
5. **Windows line endings and Git.** `LF will be replaced by CRLF` warnings on every commit are noise that hides real warnings.
6. **PowerShell tooling friction.** Passing binary blobs to the AWS CLI (`fileb://`, `--cli-input-json`, UTF-8 BOM) cost time; a `bash` shell avoided it.

## Suggestions

- Put the `exactOptionalPropertyTypes` conditional-spread pattern in the TypeScript handbook's error page.
- Have `tsc` suggest the missing `.js` extension in `NodeNext` mode (it may in newer versions; the hint was not obvious here).
- Document a multi-surface tsconfig recipe (server / browser / bundle) as an official example.
- For CLI blob arguments, document the base64/`fileb://` forms side by side.

## What we did

- One `typecheck` script running `tsconfig.test.json`, `ui/tsconfig.json`, and `web/tsconfig.json`.
- Conditional spreads for every optional property in the provider layer.
- `pretest` builds the View so bundle tests cannot pass against a stale artifact.
