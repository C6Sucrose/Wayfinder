import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { APP_RESOURCE_URI, readAppHtml } from "./appResource.js";
import { z } from "zod";
import type { Store } from "../storage/types.js";
import type { Extractor } from "../domain/scanPipeline.js";
import { createScan } from "../domain/scans.js";
import type { ScanWorker } from "../scan/worker.js";
import { copy } from "../domain/copy.js";
import { rememberObject, findObject } from "../domain/objectMemory.js";
import { applyAction } from "../domain/applyAction.js";
import { parseLabel } from "../domain/labelParser.js";
import { redactSensitive } from "../domain/redact.js";
import { buildBacklog, describeThread, type BacklogEntry } from "../domain/backlog.js";
import { createLedger } from "../domain/ledgerLog.js";
import { withLifecycle } from "../domain/lifecycle.js";
import { buildRecordReport, verifyLedger } from "../domain/ledger.js";
import type { Item } from "../domain/model.js";

export interface ServerDeps {
  store: Store;
  extract?: Extractor;
  worker?: ScanWorker;
}

export function buildServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: "wayfinder", version: "0.1.0" }, { capabilities: { logging: {} } });

  const safeError = (tool: string, err: unknown, message: string = copy.toolUnavailable) => {
    console.error(`[${tool}] failed:`, err);
    return {
      content: [{ type: "text" as const, text: message }],
      isError: true as const
    };
  };

  server.tool(
    "capture_scan",
    "Start reading images the customer captured. Use for mail, labels, or objects.",
    { imageRefs: z.array(z.string()).min(1), hint: z.enum(["mail", "label", "object", "scene", "auto"]).default("auto") },
    async ({ imageRefs, hint }) => {
      if (!deps.extract || !deps.worker) {
        return {
          content: [{ type: "text", text: copy.readerUnavailable }],
          structuredContent: { available: false, count: 0 }
        };
      }
      if (deps.worker.isFull()) {
        return {
          content: [{ type: "text", text: copy.toolUnavailable }],
          isError: true as const,
          structuredContent: { available: false }
        };
      }
      let scan;
      try {
        scan = await createScan(deps.store, { imageRefs, hint });
        deps.worker.enqueue({ scanId: scan.scanId, imageRefs, hint });
      } catch (err) {
        console.error("[capture_scan] enqueue failed:", err);
        return {
          content: [{ type: "text", text: copy.toolUnavailable }],
          isError: true as const,
          structuredContent: { available: false }
        };
      }
      return {
        content: [{ type: "text", text: copy.scanStarted }],
        structuredContent: { scanId: scan.scanId, status: "queued", available: true }
      };
    }
  );

  registerAppTool(
    server,
    "get_scan",
    {
      description: "Return the items found in a previous scan, with their suggested actions.",
      inputSchema: { scanId: z.string() },
      _meta: { ui: { resourceUri: APP_RESOURCE_URI } }
    },
    async ({ scanId }) => {
      const scan = await deps.store.getScan(scanId);
      if (!scan) {
        return { content: [{ type: "text", text: copy.nothingFound }], isError: true };
      }
      let items: Item[];
      try {
        items = (await deps.store.listItems("all")).filter((i) => i.scanId === scanId);
      } catch (err) {
        return safeError("get_scan", err);
      }
      if (scan.status === "queued" || scan.status === "analyzing") {
        return {
          content: [{ type: "text", text: copy.scanQueued }],
          structuredContent: { scanId, status: scan.status, items: [] }
        };
      }
      if (scan.status === "failed") {
        return {
          content: [{ type: "text", text: copy.scanFailed }],
          structuredContent: { scanId, status: "failed", items: [] }
        };
      }
      const spoken = items
        .map((i) => (i.class === "label" ? `${i.readAloudText} ${copy.disclaimers.label}` : i.readAloudText))
        .join(" ");
      return {
        content: [{ type: "text", text: spoken || copy.nothingFound }],
        structuredContent: { scanId, status: scan.status, items }
      };
    }
  );

  registerAppTool(
    server,
    "find_object",
    {
      description: "Find where an object was last seen.",
      inputSchema: { name: z.string() },
      _meta: { ui: { resourceUri: APP_RESOURCE_URI } }
    },
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
    { itemId: z.string(), actionId: z.string(), confirmed: z.boolean().default(false) },
    async ({ itemId, actionId, confirmed }) => {
      try {
        const result = await applyAction(deps.store, itemId, actionId, { confirmed });
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: { action: result.action, item: result.item, decision: result.decision }
        };
      } catch (err) {
        return safeError("act_on_item", err, copy.toolFailed);
      }
    }
  );

  registerAppTool(
    server,
    "list_items",
    {
      description: "List the customer's items, optionally filtered to unresolved, due, or flagged.",
      inputSchema: { filter: z.enum(["unresolved", "due", "flagged", "all"]).default("unresolved") },
      _meta: { ui: { resourceUri: APP_RESOURCE_URI } }
    },
    async ({ filter }) => {
      let items: Item[];
      try {
        items = await deps.store.listItems(filter);
      } catch (err) {
        return safeError("list_items", err);
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

  registerAppTool(
    server,
    "get_item",
    {
      description: "Return one item's full detail and read-aloud text.",
      inputSchema: { itemId: z.string() },
      _meta: { ui: { resourceUri: APP_RESOURCE_URI } }
    },
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
    "get_backlog",
    "Rank what needs attention by urgency, with outstanding demands and related documents.",
    { date: z.string().optional() },
    async ({ date }) => {
      if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return { content: [{ type: "text", text: copy.invalidDate }], isError: true as const };
      }
      let backlog: BacklogEntry[];
      try {
        backlog = await buildBacklog(deps.store, date ? new Date(`${date}T12:00:00.000Z`) : new Date());
      } catch (err) {
        return safeError("get_backlog", err);
      }
      const outstanding = backlog.filter((e) => e.thread.outstanding);
      const text = outstanding.length === 0
        ? copy.backlog.empty
        : copy.backlog.summary(outstanding.length, describeThread(outstanding[0]!.thread, outstanding[0]!.deadline));
      return { content: [{ type: "text", text }], structuredContent: { backlog } };
    }
  );

  server.tool(
    "get_audit",
    "Explain what happened to a document or thread, from the record.",
    { documentId: z.string().optional(), threadKey: z.string().optional() },
    async ({ documentId, threadKey }) => {
      if (documentId === undefined && threadKey === undefined) {
        return { content: [{ type: "text", text: copy.audit.empty }], structuredContent: { entries: [] } };
      }
      let entries: Awaited<ReturnType<ReturnType<typeof createLedger>["read"]>>;
      try {
        entries = (await createLedger(deps.store).read()).filter(
          (e) => (documentId === undefined || e.documentId === documentId)
            && (threadKey === undefined || e.threadKey === threadKey)
        );
      } catch (err) {
        return safeError("get_audit", err);
      }
      const text = entries.length === 0 ? copy.audit.empty : entries.map((e) => e.event).join(", ");
      return { content: [{ type: "text", text }], structuredContent: { entries } };
    }
  );

  server.tool(
    "verify_ledger",
    "Prove the record has not been altered since it was written.",
    {},
    async () => {
      try {
        const entries = await createLedger(deps.store).read();
        const result = verifyLedger(entries);
        const terminal = entries[entries.length - 1]?.hash ?? "0".repeat(64);
        const text = result.ok
          ? copy.ledger.verified(result.entries, terminal)
          : copy.ledger.tampered(result.firstMismatchSeq ?? 1);
        return { content: [{ type: "text", text }], structuredContent: { ...result, terminal } };
      } catch (err) {
        return safeError("verify_ledger", err);
      }
    }
  );

  server.tool(
    "export_record",
    "Produce a voice-friendly report of what the system saw and did, over a period.",
    { from: z.string().optional(), to: z.string().optional() },
    async ({ from, to }) => {
      try {
        const range = {
          ...(from !== undefined ? { from } : {}),
          ...(to !== undefined ? { to } : {})
        };
        const report = buildRecordReport(await createLedger(deps.store).read(), range);
        return { content: [{ type: "text", text: report }], structuredContent: { report } };
      } catch (err) {
        return safeError("export_record", err);
      }
    }
  );

  server.tool(
    "escalate_item",
    "Hand an item the customer can't resolve to their trusted contact.",
    { documentId: z.string().optional(), threadKey: z.string().optional(), reason: z.string().optional() },
    async ({ documentId, threadKey, reason }) => {
      if (documentId === undefined && threadKey === undefined) {
        return { content: [{ type: "text", text: copy.escalateTarget }], isError: true as const };
      }
      try {
        const preferences = await deps.store.getPreferences();
        if (!preferences.trustedContactAlias) {
          return { content: [{ type: "text", text: copy.noTrustedContact }], isError: true as const };
        }
        const at = new Date().toISOString();
        if (documentId !== undefined) {
          const item = await deps.store.getItem(documentId);
          if (!item) {
            return { content: [{ type: "text", text: copy.escalateUnknown }], isError: true as const };
          }
          await deps.store.putItem(withLifecycle(item, "escalated", at));
        }
        await createLedger(deps.store).append({
          at,
          actor: "user",
          event: "escalated",
          ...(documentId !== undefined ? { documentId } : {}),
          ...(threadKey !== undefined ? { threadKey } : {}),
          ...(reason !== undefined ? { details: { reason } } : {})
        });
        return {
          content: [{ type: "text", text: copy.escalated(preferences.trustedContactAlias) }],
          structuredContent: { escalated: true }
        };
      } catch (err) {
        return safeError("escalate_item", err);
      }
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

  registerAppTool(
    server,
    "identify_product",
    {
      description: "Read a product, food, or medication label back to the customer, verbatim.",
      inputSchema: { imageRefs: z.array(z.string()).min(1) },
      _meta: { ui: { resourceUri: APP_RESOURCE_URI } }
    },
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
        content: [{ type: "text", text: `${parsed.labelText} ${parsed.disclaimer}` }],
        structuredContent: parsed
      };
    }
  );

  registerAppTool(
    server,
    "daily_briefing",
    {
      description: "Give the customer a summary of what is due, upcoming, or flagged, plus saved object reminders.",
      inputSchema: { date: z.string().optional() },
      _meta: { ui: { resourceUri: APP_RESOURCE_URI } }
    },
    async ({ date }) => {
      if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return { content: [{ type: "text", text: copy.invalidDate }], isError: true as const };
      }
      let due: Item[];
      let appointments: Item[];
      let flagged: Item[];
      let objectReminders: Awaited<ReturnType<Store["listObjects"]>>;
      let backlog: BacklogEntry[];
      try {
        const reference = (date ?? new Date().toISOString()).slice(0, 10);
        const [unresolved, flaggedItems, objects, ranked] = await Promise.all([
          deps.store.listItems("unresolved"),
          deps.store.listItems("flagged"),
          deps.store.listObjects(),
          buildBacklog(deps.store, new Date(`${reference}T12:00:00.000Z`))
        ]);
        due = unresolved.filter((i) => i.fields.dueDate !== undefined && i.fields.dueDate <= reference);
        appointments = unresolved
          .filter((i) => i.class === "appointment" && i.fields.appointmentAt !== undefined)
          .sort((a, b) => a.fields.appointmentAt!.localeCompare(b.fields.appointmentAt!));
        flagged = flaggedItems;
        objectReminders = objects;
        backlog = ranked;
      } catch (err) {
        return safeError("daily_briefing", err);
      }

      const parts: string[] = [];
      if (due.length) parts.push(copy.briefing.due(due.length));
      if (appointments.length) parts.push(copy.briefing.appointments(appointments.length));
      if (flagged.length) parts.push(copy.briefing.flagged(flagged.length));
      if (objectReminders.length) parts.push(copy.briefing.reminders(objectReminders.length));
      const outstanding = backlog.filter((e) => e.thread.outstanding);
      const lead = outstanding.length
        ? `${copy.backlog.summary(outstanding.length, describeThread(outstanding[0]!.thread, outstanding[0]!.deadline))} `
        : "";
      const summary = parts.length
        ? copy.briefing.summary(parts)
        : outstanding.length ? "" : copy.briefing.clear;

      return {
        content: [{ type: "text", text: `${lead}${summary}` }],
        structuredContent: { due, appointments, flagged, objectReminders, backlog }
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

  server.resource(
    "ledger",
    "wayfinder://ledger",
    { description: "The tamper-evident record of what the system saw and did." },
    async (uri) => {
      const entries = await createLedger(deps.store).read();
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ entries, verification: verifyLedger(entries) })
        }]
      };
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
            text: copy.prompts.morningBriefing
          }
        }
      ]
    })
  );

  registerAppResource(
    server,
    "Wayfinder View",
    APP_RESOURCE_URI,
    { description: "Interactive Wayfinder cards: inbox, item detail, briefing, labels." },
    async () => ({
      contents: [{ uri: APP_RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: readAppHtml() }]
    })
  );

  return server;
}
