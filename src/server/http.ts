import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Store } from "../storage/types.js";
import type { Extractor } from "../domain/scanPipeline.js";
import type { ScanWorker } from "../scan/worker.js";
import type { AgentService } from "../agent/service.js";
import { buildServer } from "../mcp/server.js";
import { copy } from "../domain/copy.js";

export function isAllowedOrigin(origin: string | undefined, extra: string[]): boolean {
  if (origin === undefined || origin === "") return true; // non-browser clients omit Origin
  let url: URL;
  try { url = new URL(origin); } catch { return false; }
  const host = url.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;
  return extra.includes(origin);
}

export function resolveHost(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOST?.trim() || "127.0.0.1";
}

export interface HttpDeps {
  store: Store;
  extract?: Extractor;
  allowedOrigins?: string[];
  worker?: ScanWorker;
  agent?: AgentService;
}

export function createHttpApp(deps: HttpDeps) {
  const app = express();
  const allowed = deps.allowedOrigins ?? [];
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; notify: (message: string) => void }>();

  // Enforce Origin before body parsing so a disallowed origin gets 403 even when
  // its body is malformed or oversized.
  app.use((req, res, next) => {
    if (req.path.startsWith("/mcp") && !isAllowedOrigin(req.headers.origin, allowed)) {
      res.status(403).json({ jsonrpc: "2.0", error: { code: -32000, message: "Forbidden: origin not allowed" }, id: null });
      return;
    }
    next();
  });
  app.use(express.json({ limit: "10mb" }));

  app.get("/healthz", (_req, res) => { res.json({ ok: true }); });

  app.locals.notifyAll = (message: string) => {
    for (const session of sessions.values()) session.notify(message);
  };

  app.post("/api/agent", async (req, res) => {
    const utterance = typeof req.body?.utterance === "string" ? req.body.utterance : "";
    if (!utterance.trim()) { res.status(400).json({ error: "utterance required" }); return; }
    if (!deps.agent) { res.status(503).json({ error: "agent unavailable" }); return; }
    try {
      res.json(await deps.agent.handle(utterance));
    } catch (err) {
      console.error("[api/agent] agent failed:", err);
      res.status(502).json({ error: copy.toolFailed });
    }
  });

  const handle = async (req: express.Request, res: express.Response) => {
    const sessionId = req.headers["mcp-session-id"];
    let session = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
    if (!session) {
      if (req.method === "POST" && isInitializeRequest(req.body)) {
        const server = buildServer(deps);
        const notify = (message: string) => {
          void server.server.notification({ method: "notifications/message", params: { level: "info", data: message } }).catch(() => undefined);
        };
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => { sessions.set(sid, { transport, notify }); }
        });
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        await server.connect(transport as unknown as Transport);
        session = { transport, notify };
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID provided" },
          id: null
        });
        return;
      }
    }
    await session.transport.handleRequest(req, res, req.body);
  };

  app.post("/mcp", handle);
  app.get("/mcp", handle);
  app.delete("/mcp", handle);
  return app;
}
