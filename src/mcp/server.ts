import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Store } from "../storage/types.js";
import { runScan, type Extractor } from "../domain/scanPipeline.js";
import { copy } from "../domain/copy.js";
import { rememberObject, findObject } from "../domain/objectMemory.js";

export function buildServer(deps: { store: Store; extract?: Extractor }): McpServer {
  const server = new McpServer({ name: "wayfinder", version: "0.1.0" });

  server.tool(
    "capture_scan",
    "Start reading images the customer captured. Use for mail, labels, or objects.",
    { imageRefs: z.array(z.string()).min(1), hint: z.enum(["mail", "label", "object", "scene", "auto"]).default("auto") },
    async ({ imageRefs, hint }) => {
      const extract: Extractor = deps.extract ?? (async () => []);
      let extractedText: string[];
      try {
        extractedText = await extract(imageRefs, hint);
      } catch (err) {
        console.error("[capture_scan] extractor failed:", err);
        extractedText = [];
      }
      const scan = await runScan(deps.store, { imageRefs, hint, extractedText });
      const items = await deps.store.listItems("all");
      const mine = items.filter((i) => i.scanId === scan.scanId);
      return {
        content: [{ type: "text", text: mine.length ? `I read ${mine.length} item(s).` : copy.scanFailed }],
        structuredContent: { scanId: scan.scanId, count: mine.length }
      };
    }
  );

  server.tool(
    "get_scan",
    "Return the items found in a previous scan, with their suggested actions.",
    { scanId: z.string() },
    async ({ scanId }) => {
      const items = (await deps.store.listItems("all")).filter((i) => i.scanId === scanId);
      return {
        content: [{ type: "text", text: items.map((i) => i.readAloudText).join(" ") || copy.nothingFound }],
        structuredContent: { items }
      };
    }
  );

  server.tool(
    "find_object",
    "Find where an object was last seen.",
    { name: z.string() },
    async ({ name }) => {
      const found = await findObject(deps.store, name);
      return {
        content: [{ type: "text", text: found ? `Last seen ${found.locationNote}.` : `I don't have a location for ${name}.` }],
        structuredContent: { found }
      };
    }
  );

  server.tool(
    "remember_object",
    "Remember where an object is.",
    { name: z.string(), locationNote: z.string(), imageRef: z.string().optional() },
    async ({ name, locationNote, imageRef }) => {
      const obj = await rememberObject(deps.store, imageRef ? { name, locationNote, imageRef } : { name, locationNote });
      return { content: [{ type: "text", text: `Saved ${obj.name}.` }], structuredContent: { object: obj } };
    }
  );

  return server;
}
