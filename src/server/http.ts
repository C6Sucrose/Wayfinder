import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Store } from "../storage/types.js";
import { buildServer } from "../mcp/server.js";

export function createHttpApp(deps: { store: Store }) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.get("/healthz", (_req, res) => { res.json({ ok: true }); });

  const handle = async (req: express.Request, res: express.Response) => {
    const sessionId = req.headers["mcp-session-id"];
    let transport: StreamableHTTPServerTransport | undefined =
      typeof sessionId === "string" ? transports.get(sessionId) : undefined;
    if (!transport) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => { transports.set(sid, transport!); }
      });
      transport.onclose = () => {
        if (transport!.sessionId) transports.delete(transport!.sessionId);
      };
      await buildServer(deps).connect(transport as unknown as Transport);
    }
    await transport.handleRequest(req, res, req.body);
  };

  app.post("/mcp", handle);
  app.get("/mcp", handle);
  app.delete("/mcp", handle);
  return app;
}
