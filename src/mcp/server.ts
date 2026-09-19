import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Store } from "../storage/types.js";
import { runScan, type Extractor } from "../domain/scanPipeline.js";
import { copy } from "../domain/copy.js";
import { rememberObject, findObject } from "../domain/objectMemory.js";
import { applyAction } from "../domain/applyAction.js";
import { parseLabel } from "../domain/labelParser.js";
import { redactSensitive } from "../domain/redact.js";
import type { Item } from "../domain/model.js";

export function buildServer(deps: { store: Store; extract?: Extractor }): McpServer {
  const server = new McpServer({ name: "wayfinder", version: "0.1.0" });

  const safeError = (tool: string, err: unknown) => {
    console.error(`[${tool}] failed:`, err);
    return {
      content: [{ type: "text" as const, text: copy.toolFailed }],
      isError: true as const
    };
  };

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
        content: [{ type: "text", text: mine.length ? copy.scanRead(mine.length) : copy.scanFailed }],
        structuredContent: { scanId: scan.scanId, count: mine.length, available: true }
      };
    }
  );

  server.tool(
    "get_scan",
    "Return the items found in a previous scan, with their suggested actions.",
    { scanId: z.string() },
    async ({ scanId }) => {
      let items: Item[];
      try {
        items = (await deps.store.listItems("all")).filter((i) => i.scanId === scanId);
      } catch (err) {
        return safeError("get_scan", err);
      }
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
      let found;
      try {
        found = await findObject(deps.store, name);
      } catch (err) {
        return safeError("find_object", err);
      }
      return {
        content: [{ type: "text", text: found ? copy.lastSeen(found.locationNote) : copy.noLocation(name) }],
        structuredContent: { found }
      };
    }
  );

  server.tool(
    "remember_object",
    "Remember where an object is.",
    { name: z.string(), locationNote: z.string(), imageRef: z.string().optional() },
    async ({ name, locationNote, imageRef }) => {
      let obj;
      try {
        obj = await rememberObject(deps.store, imageRef ? { name, locationNote, imageRef } : { name, locationNote });
      } catch (err) {
        return safeError("remember_object", err);
      }
      return { content: [{ type: "text", text: copy.savedObject(obj.name) }], structuredContent: { object: obj } };
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
        return safeError("act_on_item", err);
      }
    }
  );

  server.tool(
    "list_items",
    "List the customer's items, optionally filtered to unresolved, due, or flagged.",
    { filter: z.enum(["unresolved", "due", "flagged", "all"]).default("unresolved") },
    async ({ filter }) => {
      let items: Item[];
      try {
        items = await deps.store.listItems(filter);
      } catch (err) {
        return safeError("list_items", err);
      }
      return {
        content: [{ type: "text", text: items.length ? copy.itemsListed(items.length) : copy.nothingFound }],
        structuredContent: { items }
      };
    }
  );

  server.tool(
    "get_item",
    "Return one item's full detail and read-aloud text.",
    { itemId: z.string() },
    async ({ itemId }) => {
      let item: Item | null;
      try {
        item = await deps.store.getItem(itemId);
      } catch (err) {
        return safeError("get_item", err);
      }
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
      try {
        const current = await deps.store.getPreferences();
        const updated = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
        await deps.store.putPreferences(updated);
        return { content: [{ type: "text", text: copy.preferencesSaved }], structuredContent: { preferences: updated } };
      } catch (err) {
        return safeError("update_preferences", err);
      }
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
    "Give the customer a summary of what is due, upcoming, or flagged, plus saved object reminders.",
    { date: z.string().optional() },
    async ({ date }) => {
      let due: Item[];
      let appointments: Item[];
      let flagged: Item[];
      let objectReminders: Awaited<ReturnType<Store["listObjects"]>>;
      try {
        const reference = (date ?? new Date().toISOString()).slice(0, 10);
        const [unresolved, flaggedItems, objects] = await Promise.all([
          deps.store.listItems("unresolved"),
          deps.store.listItems("flagged"),
          deps.store.listObjects()
        ]);
        due = unresolved.filter((i) => i.fields.dueDate !== undefined && i.fields.dueDate <= reference);
        appointments = unresolved
          .filter((i) => i.class === "appointment" && i.fields.appointmentAt !== undefined)
          .sort((a, b) => a.fields.appointmentAt!.localeCompare(b.fields.appointmentAt!));
        flagged = flaggedItems;
        objectReminders = objects;
      } catch (err) {
        return safeError("daily_briefing", err);
      }

      const parts: string[] = [];
      if (due.length) parts.push(copy.briefing.due(due.length));
      if (appointments.length) parts.push(copy.briefing.appointments(appointments.length));
      if (flagged.length) parts.push(copy.briefing.flagged(flagged.length));
      if (objectReminders.length) parts.push(copy.briefing.reminders(objectReminders.length));
      const summary = parts.length ? copy.briefing.summary(parts) : copy.briefing.clear;

      return {
        content: [{ type: "text", text: summary }],
        structuredContent: { due, appointments, flagged, objectReminders }
      };
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
