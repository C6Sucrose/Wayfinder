import type { Extractor } from "../domain/scanPipeline.js";
import { loadImage } from "./imageSource.js";

export interface TextractBlock {
  type: "PAGE" | "LINE" | "WORD" | string;
  text?: string;
  page?: number;
}

export interface TextractLike {
  detectDocumentText(input: { bytes: Uint8Array }): Promise<TextractBlock[]>;
}

const MAX_BYTES = 5 * 1024 * 1024;
const SUPPORTED = new Set(["jpeg", "png"]);

export function createTextractExtractor(deps: {
  client: TextractLike;
  allowedRoot?: string;
  maxBytes?: number;
}): Extractor {
  const limit = deps.maxBytes ?? MAX_BYTES;
  return async (imageRefs) => {
    const texts: string[] = [];
    for (const ref of imageRefs) {
      const image = await loadImage(ref, deps.allowedRoot !== undefined ? { root: deps.allowedRoot } : undefined);
      if (!SUPPORTED.has(image.format)) {
        throw new Error(`Textract does not support ${image.format} images`);
      }
      if (image.bytes.byteLength > limit) {
        throw new Error(`Image is too large for Textract (${image.bytes.byteLength} bytes)`);
      }
      const blocks = await deps.client.detectDocumentText({ bytes: image.bytes });
      const pages = new Map<number, string[]>();
      for (const block of blocks) {
        const page = block.page ?? 1;
        if (!pages.has(page)) pages.set(page, []);
        if (block.type !== "LINE" || block.text === undefined) continue;
        pages.get(page)!.push(block.text);
      }
      const pageTexts = [...pages.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, lines]) => lines.join("\n").trim());
      if (pageTexts.length === 0) texts.push("");
      else texts.push(...pageTexts);
    }
    return texts;
  };
}
