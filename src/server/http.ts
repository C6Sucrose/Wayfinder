import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Store } from "../storage/types.js";
import type { Extractor } from "../domain/scanPipeline.js";
import { buildServer } from "../mcp/server.js";

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

export function createHttpApp(deps: { store: Store; extract?: Extractor; allowedOrigins?: string[] }) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const allowed = deps.allowedOrigins ?? [];
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.get("/healthz", (_req, res) => { res.json({ ok: true }); });

  const handle = async (req: express.Request, res: express.Response) => {
    if (!isAllowedOrigin(req.headers.origin, allowed)) {
      res.status(403).json({ jsonrpc: "2.0", error: { code: -32000, message: "Forbidden: origin not allowed" }, id: null });
      return;
    }
    const sessionId = req.headers["mcp-session-id"];
    let transport: StreamableHTTPServerTransport | undefined =
      typeof sessionId === "string" ? transports.get(sessionId) : undefined;
    if (!transport) {
      if (req.method === "POST" && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => { transports.set(sid, transport!); }
        });
        transport.onclose = () => {
          if (transport!.sessionId) transports.delete(transport!.sessionId);
        };
        await buildServer(deps).connect(transport as unknown as Transport);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID provided" },
          id: null
        });
        return;
      }
    }
    await transport.handleRequest(req, res, req.body);
  };

  app.post("/mcp", handle);
  app.get("/mcp", handle);
  app.delete("/mcp", handle);
  return app;
}
