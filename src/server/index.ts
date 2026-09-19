import { createHttpApp, resolveHost } from "./http.js";
import { createFileStore } from "../storage/fileStore.js";

const dir = process.env.WAYFINDER_DATA_DIR ?? "data";
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const app = createHttpApp({ store: createFileStore(dir), allowedOrigins });
const port = Number(process.env.PORT ?? 8080);
const host = resolveHost();
console.log("[wayfinder] extractor: none configured (Plan 3 wires Bedrock)");
app.listen(port, host, () => console.log(`Wayfinder MCP server on ${host}:${port}`));
