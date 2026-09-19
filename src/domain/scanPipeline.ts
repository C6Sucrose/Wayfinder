import type { Store } from "../storage/types.js";
import type { Scan } from "./model.js";
import { ItemSchema } from "./model.js";
import { classifyText } from "./classifier.js";
import { extractFields } from "./extractors.js";
import { scoreScam } from "./scam.js";
import { planActions } from "./actionPlanner.js";
import { randomUUID } from "node:crypto";

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
  for (const text of texts) {
    const signals = {
      hasQrOrLink: /https?:\/\/|\bQR\b/i.test(text),
      hasPaymentRequest: /pay|payment|transfer|überweisen/i.test(text),
      senderMismatch: /dear customer/i.test(text)
    };
    const { class: cls, confidence } = classifyText(text, signals);
    const fields = extractFields(text, cls);
    const scam = scoreScam(text, signals);
    const itemId = `itm_${randomUUID().slice(0, 8)}`;
    const actions = planActions(
      { itemId, scanId, class: cls, confidence, readAloudText: text, fields, proposedActions: [], createdAt: new Date().toISOString(), resolvedAt: null },
      scam
    );
    const item = ItemSchema.parse({
      itemId, scanId, class: cls, confidence, readAloudText: text,
      fields, proposedActions: actions, createdAt: new Date().toISOString(), resolvedAt: null
    });
    await store.putItem(item);
  }

  const done: Scan = { ...scan, status: texts.length > 0 ? "ready" : "failed" };
  await store.putScan(done);
  return done;
}
