import { createHttpApp } from "./http.js";
import { createFileStore } from "../storage/fileStore.js";

const dir = process.env.WAYFINDER_DATA_DIR ?? "data";
const app = createHttpApp({ store: createFileStore(dir) });
const port = Number(process.env.PORT ?? 8080);
console.log("[wayfinder] extractor configured:", process.env.WAYFINDER_EXTRACTOR === "bedrock");
app.listen(port, () => console.log(`Wayfinder MCP server on :${port}`));
