import { createHttpApp, resolveHost, type HttpDeps } from "./http.js";
import { createFileStore } from "../storage/fileStore.js";
import { createScanWorker } from "../scan/worker.js";
import { createBedrockExtractor } from "../scan/bedrockExtractor.js";
import { createMcpExecutor, type McpClientLike } from "../agent/mcpExecutor.js";
import { createAgentService } from "../agent/service.js";
import { scanCompleteMessage } from "../domain/scans.js";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

const dir = process.env.WAYFINDER_DATA_DIR ?? "data";
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const port = Number(process.env.PORT ?? 8080);
const host = resolveHost();

const store = createFileStore(dir);
const modelId = process.env.BEDROCK_MODEL_ID;
const bedrock = modelId ? new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "eu-central-1" }) : undefined;
const converse = bedrock
  ? { send: (input: unknown) => bedrock.send(new ConverseCommand(input as never)) }
  : undefined;
const extract = modelId && converse ? createBedrockExtractor({ client: converse, modelId }) : undefined;

const deps: HttpDeps = { store, allowedOrigins, ...(extract ? { extract } : {}) };
const app = createHttpApp(deps);

const worker = createScanWorker({
  store,
  onComplete: (id) => {
    void (async () => {
      try {
        app.locals.notifyAll(scanCompleteMessage(await store.getScan(id)));
      } catch (err) {
        console.error(`[wayfinder] scan ${id} status lookup failed:`, err);
        app.locals.notifyAll(scanCompleteMessage(null));
      }
    })();
  },
  ...(extract ? { extract } : {})
});
deps.worker = worker;

const mcpUrl = new URL(`http://${host}:${port}/mcp`);
const mcpTransport = new StreamableHTTPClientTransport(mcpUrl);
const mcpClient = new Client({ name: "wayfinder-agent", version: "0.1.0" });
let connecting: Promise<void> | undefined;
const ensureConnected = () => {
  if (!connecting) {
    connecting = mcpClient.connect(mcpTransport as unknown as Transport).catch((err: unknown) => {
      connecting = undefined;
      throw err;
    });
  }
  return connecting;
};
const client: McpClientLike = {
  async listTools() {
    await ensureConnected();
    const { tools } = await mcpClient.listTools();
    return {
      tools: tools.map((t) => ({
        name: t.name,
        ...(t.description !== undefined ? { description: t.description } : {}),
        inputSchema: t.inputSchema
      }))
    };
  },
  async callTool(request) {
    await ensureConnected();
    const result = await mcpClient.callTool(request);
    return { isError: result.isError === true, content: result.content };
  },
  async close() { if (connecting) { await connecting; await mcpClient.close(); } }
};
const executor = createMcpExecutor({ client });
deps.agent = createAgentService({
  executor,
  ...(converse && modelId ? { client: converse, modelId } : {})
});

console.log(`[wayfinder] extractor: ${extract ? "bedrock" : "none (reader unavailable)"}`);
app.listen(port, host, () => console.log(`Wayfinder MCP server on ${host}:${port}`));
