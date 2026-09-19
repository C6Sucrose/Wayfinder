import type { Store } from "../storage/types.js";
import type { Item, Scan } from "./model.js";
import { ItemSchema } from "./model.js";
import { classifyText } from "./classifier.js";
import { extractFields } from "./extractors.js";
import { redactSensitive } from "./redact.js";
import { scoreScam } from "./scam.js";
import { planActions } from "./actionPlanner.js";
import { randomUUID } from "node:crypto";

export type Extractor = (imageRefs: string[], hint: Scan["hint"]) => Promise<string[]>;

export interface ScanInput {
  imageRefs: string[];
  hint: Scan["hint"];
  extractedText?: string[]; // in Plan 3 this is produced by Bedrock; here it is injected
}

export async function runScan(store: Store, input: ScanInput): Promise<Scan> {
  const scanId = `scn_${randomUUID().slice(0, 8)}`;
  const scan: Scan = {
    scanId, hint: input.hint, imageRefs: input.imageRefs,
    status: "analyzing", createdAt: new Date().toISOString()
  };
  await store.putScan(scan);

  const texts = input.extractedText ?? [];
  const items: Item[] = [];
  try {
    for (const text of texts) {
      const signals = {
        hasQrOrLink: /https?:\/\/|\bQR\b/i.test(text),
        hasPaymentRequest: /\b(?:pay|payment|transfer|überweisen)\b/i.test(text),
        senderMismatch: /\bdear customer\b/i.test(text)
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
      items.push(ItemSchema.parse({
        itemId, scanId, class: cls, confidence, readAloudText,
        fields, proposedActions: actions, createdAt, resolvedAt: null
      }));
    }
  } catch (err) {
    console.error(`[scanPipeline] scan ${scanId} failed during analysis:`, err);
    const failed: Scan = { ...scan, status: "failed" };
    await store.putScan(failed);
    return failed;
  }

  // Persist only after every text was analyzed successfully, so a failure
  // never leaves a partially-written scan behind.
  for (const item of items) {
    await store.putItem(item);
  }

  const done: Scan = { ...scan, status: items.length > 0 ? "ready" : "failed" };
  await store.putScan(done);
  return done;
}
