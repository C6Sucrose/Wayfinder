import { randomUUID } from "node:crypto";
import type { Store } from "../storage/types.js";
import type { Item, Scan } from "./model.js";
import { ItemSchema } from "./model.js";
import { classifyText } from "./classifier.js";
import { extractFields } from "./extractors.js";
import { redactSensitive } from "./redact.js";
import { scoreScam } from "./scam.js";
import { planActions } from "./actionPlanner.js";

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

export async function processScan(store: Store, scanId: string, texts: string[]): Promise<Scan> {
  const scan = await store.getScan(scanId);
  if (!scan) throw new Error("Unknown scan.");

  const analyzing: Scan = { ...scan, status: "analyzing" };
  await store.putScan(analyzing);

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
      const actions = planActions(
        { itemId, scanId, class: cls, confidence, readAloudText, fields, proposedActions: [], createdAt, resolvedAt: null },
        scam
      );
      items.push(ItemSchema.parse({ itemId, scanId, class: cls, confidence, readAloudText, fields, proposedActions: actions, createdAt, resolvedAt: null }));
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

  const done: Scan = { ...analyzing, status: items.length > 0 ? "ready" : "failed" };
  await store.putScan(done);
  return done;
}
