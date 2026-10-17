import { createHttpApp, resolveHost, type HttpDeps } from "./http.js";
import { createFileStore } from "../storage/fileStore.js";
import { createScanWorker } from "../scan/worker.js";
import { createBedrockExtractor } from "../scan/bedrockExtractor.js";
import { createTextractClient } from "../scan/textractClient.js";
import { createTextractExtractor } from "../scan/textractExtractor.js";
import { createMcpExecutor, type McpClientLike } from "../agent/mcpExecutor.js";
import { createAgentService } from "../agent/service.js";
import { createOpenAICompatProvider } from "../providers/openaiCompat.js";
import { resolveProviderConfig, resolveVision } from "../providers/config.js";
import type { ChatProvider } from "../providers/types.js";
import type { ProviderSummary } from "../adapters/capabilities.js";
import { scanCompleteMessage } from "../domain/scans.js";
import { resolveAdapterConfig } from "../adapters/config.js";
import { createAdapters } from "../adapters/registry.js";
import { createConfiguredNotifyQueue } from "../adapters/notifyQueue.js";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

const dir = process.env.WAYFINDER_DATA_DIR ?? "data";
const captureRoot = process.env.WAYFINDER_CAPTURE_ROOT ?? dir;
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const port = Number(process.env.PORT ?? 8080);
const host = resolveHost();

const store = createFileStore(dir);
const preferences = await store.getPreferences();
const adapterConfig = resolveAdapterConfig(process.env, preferences.adapters);
const adapters = createAdapters(adapterConfig);
for (const warning of adapterConfig.warnings) console.warn(`[wayfinder] adapter: ${warning}`);
const notify = createConfiguredNotifyQueue(adapterConfig, { notifier: adapters.notifier, store });
const modelId = process.env.BEDROCK_MODEL_ID;
const bedrock = modelId ? new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "us-east-1" }) : undefined;
const converse = bedrock
  ? { send: (input: unknown) => bedrock.send(new ConverseCommand(input as never)) }
  : undefined;
const bedrockExtract = modelId && converse ? createBedrockExtractor({ client: converse, modelId, allowedRoot: captureRoot }) : undefined;

const providerConfig = resolveProviderConfig(process.env);
for (const warning of providerConfig.warnings) console.warn(`[wayfinder] provider: ${warning}`);
const vision = resolveVision(process.env, providerConfig.provider);
for (const warning of vision.warnings) console.warn(`[wayfinder] vision: ${warning}`);
const chosen = providerConfig.provider;

let brainProvider: ChatProvider | undefined;
let brainModel: string | undefined;
let brainMaxRounds: number | undefined;
if (chosen.kind === "chat") {
  brainModel = chosen.model;
  brainMaxRounds = chosen.maxRounds;
  if (chosen.protocol === "openai-compatible") {
    brainProvider = createOpenAICompatProvider({
      id: chosen.id,
      baseUrl: chosen.baseUrl,
      apiKey: chosen.apiKey,
      model: chosen.model,
      supportsImages: chosen.supportsImages,
      timeoutMs: chosen.timeoutMs,
      ...(chosen.authHeader !== undefined ? { authHeader: chosen.authHeader } : {}),
      ...(chosen.query !== undefined ? { query: chosen.query } : {})
    });
  } else {
    console.warn(`[wayfinder] provider: ${chosen.protocol} is not wired yet; using rules`);
  }
}

const extract = vision.kind === "textract"
  ? createTextractExtractor({
      client: createTextractClient(process.env.AWS_REGION ?? "us-east-1"),
      allowedRoot: captureRoot
    })
  : bedrockExtract;

const useBedrockBrain = brainProvider === undefined && chosen.kind === "rules" && converse !== undefined && Boolean(modelId);
const activeVision = extract === undefined ? "none" : vision.kind === "textract" ? "textract" : "bedrock";
const providers: ProviderSummary = {
  brain: brainProvider !== undefined
    ? {
        provider: brainProvider.id,
        ...(brainModel !== undefined ? { model: brainModel } : {}),
        protocol: brainProvider.protocol
      }
    : {
        provider: useBedrockBrain ? "bedrock" : "rules",
        ...(useBedrockBrain && modelId !== undefined ? { model: modelId, protocol: "bedrock-converse" } : {})
      },
  vision: { provider: activeVision }
};

const deps: HttpDeps = {
  store,
  allowedOrigins,
  adapterConfig,
  adapters,
  providers,
  ...(notify !== undefined ? { notify } : {}),
  ...(extract ? { extract } : {})
};
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
deps.agent = brainProvider !== undefined
  ? createAgentService({
      executor,
      provider: brainProvider,
      providerName: brainProvider.id,
      ...(brainMaxRounds !== undefined ? { maxRounds: brainMaxRounds } : {})
    })
  : createAgentService({
      executor,
      ...(useBedrockBrain && converse !== undefined && modelId !== undefined ? { client: converse, modelId } : {})
    });

console.log(`[wayfinder] brain: ${providers.brain.provider}; vision: ${providers.vision.provider}`);
app.listen(port, host, () => console.log(`Wayfinder MCP server on ${host}:${port}`));
