import { randomUUID } from "node:crypto";
import type { Store } from "../storage/types.js";
import type { DocumentState, Item, Scan } from "./model.js";
import { ItemSchema } from "./model.js";
import { classifyText } from "./classifier.js";
import { extractFields } from "./extractors.js";
import { redactSensitive } from "./redact.js";
import { scoreScam } from "./scam.js";
import { planActions } from "./actionPlanner.js";
import { copy } from "./copy.js";
import { assessReadback } from "./readback.js";
import { toDocumentRecord } from "./correlation.js";
import { createLedger } from "./ledgerLog.js";

export function scanCompleteMessage(scan: Scan | null): string {
  return scan?.status === "ready" ? copy.scanReady : copy.scanFailed;
}

export async function createScan(store: Store, input: { imageRefs: string[]; hint: Scan["hint"] }): Promise<Scan> {
  const scan: Scan = {
    scanId: `scn_${randomUUID().slice(0, 8)}`,
    hint: input.hint,
    imageRefs: input.imageRefs,
    status: "queued",
    createdAt: new Date().toISOString()
  };
  await store.putScan(scan);
  return scan;
}

const inFlight = new WeakMap<Store, Map<string, Promise<Scan>>>();

export function processScan(store: Store, scanId: string, texts: string[]): Promise<Scan> {
  let byScan = inFlight.get(store);
  if (!byScan) {
    byScan = new Map();
    inFlight.set(store, byScan);
  }
  const existing = byScan.get(scanId);
  if (existing) return existing;

  // Coalesce concurrent callers for the same scan: the terminal-state check is
  // not an atomic claim, so a second run could pass it before the first writes.
  const tracked = runProcessScan(store, scanId, texts).finally(() => {
    if (byScan.get(scanId) === tracked) byScan.delete(scanId);
  });
  byScan.set(scanId, tracked);
  return tracked;
}

async function runProcessScan(store: Store, scanId: string, texts: string[]): Promise<Scan> {
  const scan = await store.getScan(scanId);
  if (!scan) throw new Error("Unknown scan.");
  // Already terminal: return as-is so an at-least-once retry cannot duplicate items.
  if (scan.status === "ready" || scan.status === "failed") return scan;

  const analyzing: Scan = { ...scan, status: "analyzing" };
  await store.putScan(analyzing);

  // A queued/analyzing scan may be retried after a partial attempt. Drop items
  // from any earlier attempt so the re-run converges instead of accumulating.
  const stale = (await store.listItems("all")).filter((i) => i.scanId === scanId);
  for (const item of stale) {
    try { await store.deleteItem(item.itemId); } catch (e) { console.error(`[scans] cleanup of ${item.itemId} failed:`, e); }
  }

  const items: Item[] = [];
  try {
    for (const text of texts) {
      const signals = {
        hasQrOrLink: /https?:\/\/|\bQR\b/i.test(text),
        hasPaymentRequest: /\b(?:pay|payment|transfer|überweisen)\b/i.test(text),
        // Requires real sender/return-address metadata, which the deterministic
        // pipeline does not have; Plan 3's extractor may supply it. Never infer
        // a mismatch from a salutation.
        senderMismatch: false,
        genericSalutation: /\bdear (?:customer|sir\/madam|account holder)\b/i.test(text)
      };
      const { class: cls, confidence } = classifyText(text, signals);
      const fields = extractFields(text, cls);
      const scam = scoreScam(text, signals);
      const itemId = `itm_${randomUUID().slice(0, 8)}`;
      const createdAt = new Date().toISOString();
      const readAloudText = redactSensitive(text);
      const base: Item = {
        itemId, scanId, class: cls, confidence, readAloudText, fields,
        proposedActions: [], createdAt, resolvedAt: null
      };
      const actions = planActions(base, scam);
      const assessment = assessReadback({ text, fields, now: new Date(createdAt) });
      const derived = toDocumentRecord(base).record;
      const record: DocumentState = {
        ...derived,
        lifecycle: assessment.confidence === "low" ? "awaiting_action" : "open",
        confidence: assessment.confidence,
        needsRecapture: assessment.needsRecapture
      };
      items.push(ItemSchema.parse({ ...base, proposedActions: actions, record }));
    }
  } catch (err) {
    console.error(`[scans] scan ${scanId} failed during analysis:`, err);
    const failed: Scan = { ...analyzing, status: "failed" };
    await store.putScan(failed);
    return failed;
  }

  const written: string[] = [];
  try {
    for (const item of items) {
      // Record before writing: if putItem persists and then throws, the id must
      // still be rolled back. Ids are freshly generated and deleteItem is
      // idempotent, so an id for a write that never landed is harmless.
      written.push(item.itemId);
      await store.putItem(item);
    }
  } catch (err) {
    console.error(`[scans] scan ${scanId} failed while persisting:`, err);
    for (const id of written.reverse()) {
      try { await store.deleteItem(id); } catch (e) { console.error(`[scans] rollback of ${id} failed:`, e); }
    }
    const failed: Scan = { ...analyzing, status: "failed" };
    await store.putScan(failed);
    return failed;
  }

  const ledger = createLedger(store);
  for (const item of items) {
    const record = item.record;
    if (!record) continue;
    try {
      await ledger.append({
        at: item.createdAt, actor: "agent", event: "ingested",
        documentId: item.itemId, threadKey: record.threadKey,
        details: { class: item.class, confidence: record.confidence }
      });
      await ledger.append({
        at: item.createdAt, actor: "agent", event: "triaged",
        documentId: item.itemId, threadKey: record.threadKey,
        details: { lifecycle: record.lifecycle, needsRecapture: record.needsRecapture }
      });
    } catch (err) {
      console.error(`[scans] ledger append for ${item.itemId} failed:`, err);
    }
  }

  const done: Scan = { ...analyzing, status: items.length > 0 ? "ready" : "failed" };
  await store.putScan(done);
  return done;
}
