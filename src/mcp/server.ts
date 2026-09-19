import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Store } from "../storage/types.js";
import { runScan, type Extractor } from "../domain/scanPipeline.js";
import { copy } from "../domain/copy.js";
import { rememberObject, findObject } from "../domain/objectMemory.js";
import { applyAction } from "../domain/applyAction.js";
import { parseLabel } from "../domain/labelParser.js";
import { redactSensitive } from "../domain/redact.js";

export function buildServer(deps: { store: Store; extract?: Extractor }): McpServer {
  const server = new McpServer({ name: "wayfinder", version: "0.1.0" });

  server.tool(
    "capture_scan",
    "Start reading images the customer captured. Use for mail, labels, or objects.",
    { imageRefs: z.array(z.string()).min(1), hint: z.enum(["mail", "label", "object", "scene", "auto"]).default("auto") },
    async ({ imageRefs, hint }) => {
      if (!deps.extract) {
        return {
          content: [{ type: "text", text: copy.readerUnavailable }],
          structuredContent: { available: false, count: 0 }
        };
      }
      let extractedText: string[];
      try {
        extractedText = await deps.extract(imageRefs, hint);
      } catch (err) {
        console.error("[capture_scan] extractor failed:", err);
        extractedText = [];
      }
      const scan = await runScan(deps.store, { imageRefs, hint, extractedText });
      const items = await deps.store.listItems("all");
      const mine = items.filter((i) => i.scanId === scan.scanId);
      return {
        content: [{ type: "text", text: mine.length ? `I read ${mine.length} item(s).` : copy.scanFailed }],
        structuredContent: { scanId: scan.scanId, count: mine.length, available: true }
      };
    }
  );

  server.tool(
    "get_scan",
    "Return the items found in a previous scan, with their suggested actions.",
    { scanId: z.string() },
    async ({ scanId }) => {
      const items = (await deps.store.listItems("all")).filter((i) => i.scanId === scanId);
      const spoken = items
        .map((i) => (i.class === "label" ? `${i.readAloudText} ${copy.disclaimers.label}` : i.readAloudText))
        .join(" ");
      return {
        content: [{ type: "text", text: spoken || copy.nothingFound }],
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

  server.tool(
    "act_on_item",
    "Carry out one of the suggested actions for an item after the customer confirms it.",
    { itemId: z.string(), actionId: z.string() },
    async ({ itemId, actionId }) => {
      try {
        const result = await applyAction(deps.store, itemId, actionId);
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: { action: result.action, item: result.item }
        };
      } catch (err) {
        console.error("[act_on_item] failed:", err);
        return {
          content: [{ type: "text", text: "I couldn't do that — please choose the action again." }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "list_items",
    "List the customer's items, optionally filtered to unresolved, due, or flagged.",
    { filter: z.enum(["unresolved", "due", "flagged", "all"]).default("unresolved") },
    async ({ filter }) => {
      const items = await deps.store.listItems(filter);
      return {
        content: [{ type: "text", text: items.length ? `${items.length} item(s).` : copy.nothingFound }],
        structuredContent: { items }
      };
    }
  );

  server.tool(
    "get_item",
    "Return one item's full detail and read-aloud text.",
    { itemId: z.string() },
    async ({ itemId }) => {
      const item = await deps.store.getItem(itemId);
      if (!item) {
        return { content: [{ type: "text", text: copy.nothingFound }], isError: true };
      }
      const text = item.class === "label" ? `${item.readAloudText} ${copy.disclaimers.label}` : item.readAloudText;
      return { content: [{ type: "text", text }], structuredContent: { item } };
    }
  );

  server.tool(
    "update_preferences",
    "Update the customer's preferences such as verbosity or trusted contact.",
    {
      verbosity: z.enum(["brief", "normal", "detailed"]).optional(),
      trustedContactAlias: z.string().nullable().optional(),
      largeText: z.boolean().optional()
    },
    async (patch) => {
      const current = await deps.store.getPreferences();
      const updated = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
      await deps.store.putPreferences(updated);
      return { content: [{ type: "text", text: "Preferences saved." }], structuredContent: { preferences: updated } };
    }
  );

  server.tool(
    "identify_product",
    "Read a product, food, or medication label back to the customer, verbatim.",
    { imageRefs: z.array(z.string()).min(1) },
    async ({ imageRefs }) => {
      if (!deps.extract) {
        return { content: [{ type: "text", text: copy.readerUnavailable }], structuredContent: { available: false } };
      }
      let texts: string[];
      try {
        texts = await deps.extract(imageRefs, "label");
      } catch (err) {
        console.error("[identify_product] extractor failed:", err);
        texts = [];
      }
      const labelText = redactSensitive(texts.join(" ").trim());
      if (!labelText) {
        return { content: [{ type: "text", text: copy.nothingFound }], structuredContent: { available: true } };
      }
      const parsed = parseLabel(labelText);
      return {
        content: [{ type: "text", text: `${parsed.name}. ${parsed.disclaimer}` }],
        structuredContent: parsed
      };
    }
  );

  server.tool(
    "daily_briefing",
    "Give the customer a summary of what is due, upcoming, or flagged.",
    {},
    async () => {
      const [due, flagged, objects] = await Promise.all([
        deps.store.listItems("due"),
        deps.store.listItems("flagged"),
        deps.store.listObjects()
      ]);
      const summary =
        due.length + flagged.length + objects.length > 0
          ? `You have ${due.length} due, ${flagged.length} flagged.`
          : "Nothing needs your attention today.";
      return { content: [{ type: "text", text: summary }], structuredContent: { due, flagged, objects } };
    }
  );

  server.resource(
    "inbox",
    "wayfinder://inbox",
    { description: "The customer's unresolved items." },
    async (uri) => {
      const items = await deps.store.listItems("unresolved");
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ items }) }] };
    }
  );

  server.resource(
    "objects",
    "wayfinder://objects",
    { description: "Remembered household objects and their last-seen locations." },
    async (uri) => {
      const objects = await deps.store.listObjects();
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ objects }) }] };
    }
  );

  server.prompt(
    "morning_briefing",
    "Start the day by summarizing what needs the customer's attention.",
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Give me my morning briefing: what is due, what appointments are coming, and anything flagged."
          }
        }
      ]
    })
  );

  return server;
}
