import type { Store } from "../storage/types.js";
import type { Scan } from "./model.js";
import { createScan, processScan } from "./scans.js";

export type Extractor = (imageRefs: string[], hint: Scan["hint"]) => Promise<string[]>;

export interface ScanInput {
  imageRefs: string[];
  hint: Scan["hint"];
  extractedText?: string[]; // in Plan 3 this is produced by Bedrock; here it is injected
}

export async function runScan(store: Store, input: ScanInput): Promise<Scan> {
  const scan = await createScan(store, { imageRefs: input.imageRefs, hint: input.hint });
  return processScan(store, scan.scanId, input.extractedText ?? []);
}
