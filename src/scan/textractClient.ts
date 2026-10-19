import { TextractClient, DetectDocumentTextCommand } from "@aws-sdk/client-textract";
import type { TextractLike, TextractBlock } from "./textractExtractor.js";

export function createTextractClient(region: string): TextractLike {
  const client = new TextractClient({ region });
  return {
    async detectDocumentText({ bytes }): Promise<TextractBlock[]> {
      const response = await client.send(new DetectDocumentTextCommand({ Document: { Bytes: bytes } }));
      return (response.Blocks ?? []).map((block) => ({
        type: (block.BlockType ?? "LINE") as TextractBlock["type"],
        ...(block.Text !== undefined ? { text: block.Text } : {}),
        ...(block.Page !== undefined ? { page: block.Page } : {})
      }));
    }
  };
}
