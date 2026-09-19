import type { Extractor } from "../domain/scanPipeline.js";
import { loadImage } from "./imageSource.js";

export interface BedrockConverseLike {
  send(command: unknown): Promise<unknown>;
}

const PROMPT =
  "Read every piece of text visible in this image and return it verbatim, " +
  "preserving line breaks. Do not summarise, translate, or add commentary. " +
  "If there is no text, return an empty string.";

interface ConverseResponse {
  output?: { message?: { content?: Array<{ text?: string }> } };
}

export function createBedrockExtractor(deps: {
  client: BedrockConverseLike;
  modelId: string;
  maxTokens?: number;
}): Extractor {
  return async (imageRefs) => {
    const texts: string[] = [];
    for (const ref of imageRefs) {
      const image = await loadImage(ref);
      const response = (await deps.client.send({
        modelId: deps.modelId,
        messages: [
          {
            role: "user",
            content: [
              { image: { format: image.format, source: { bytes: image.bytes } } },
              { text: PROMPT }
            ]
          }
        ],
        inferenceConfig: { maxTokens: deps.maxTokens ?? 1024 }
      })) as ConverseResponse;
      const blocks = response.output?.message?.content ?? [];
      texts.push(blocks.map((b) => b.text ?? "").join("\n").trim());
    }
    return texts;
  };
}
