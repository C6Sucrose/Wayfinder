# MCP SDK feedback

**Package:** `@modelcontextprotocol/sdk` **1.30.0**, protocol `2025-11-25`.

**Used for** the MCP server (tools, resources, prompts, the app resource) and the client the agent uses to call its own tools.

**Severity: Medium.**

## What worked

- **Streamable HTTP with sessions** was straightforward: `StreamableHTTPServerTransport` plus a session map keyed by `mcp-session-id`, and `isInitializeRequest` to distinguish a new session from a bad request.
- **`InMemoryTransport.createLinkedPair()`** made integration tests trivial. Every tool test opens a client and server in-process with no network — this is the single best part of the SDK for testing.
- **Tool schemas** as Zod raw shapes are ergonomic, and validation errors are sensible.
- **Resources and prompts** use the same registration style as tools, so the surface stays uniform.
- **Server-initiated notifications** (`server.server.notification`) let us push scan-complete messages without extra plumbing.

## What was hard

1. **Session lifecycle is yours to write.** Nothing in the transport handles "no session id but a non-initialize request", so every implementation repeats the same session map, `onsessioninitialized`, and `onclose` cleanup. That is easy to get subtly wrong (a leaked session map, or a 400 where a 200 is expected).
2. **Origin and auth are entirely application concerns.** For a server that will be reached by a cloud host, the security envelope (origin allowlist, `WWW-Authenticate`, token validation) is all bespoke. The SDK gives you the protocol, not the guardrails.
3. **Error mapping is manual.** `safeError`-style wrappers that keep internal text out of spoken replies are a per-project invention.
4. **Client `callTool` result typing** is broad (`content` is a union); extracting `structuredContent` requires casts in every project.
5. **The self-client pattern is undocumented.** Running an agent against your own HTTP server works, but you must remember to connect lazily and to close on shutdown.

## Suggestions

- Ship a `createSessionManager()` helper (session map + `onsessioninitialized` + `onclose`) as a documented example, or export it.
- Document the "agent calls its own server" pattern, including lazy connect and shutdown.
- Add a typed helper for reading `structuredContent` from a `CallToolResult`.
- Include a security guide for remote deployment: origin checks, auth, and the exact 401 shape.

## What we did

- A session map keyed by `mcp-session-id`, created only on `initialize`, cleaned on `onclose`.
- An origin allowlist applied before body parsing, so a disallowed origin gets a 403 even with a malformed body.
- A single `safeError` wrapper for every tool.
