import { describe, it, expect } from "vitest";
import { createTextractExtractor, type TextractLike } from "../src/scan/textractExtractor.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function fakeTextract(blocks: Array<{ type: string; text?: string; page?: number }>): TextractLike {
  return { async detectDocumentText() { return blocks; } };
}

describe("createTextractExtractor", () => {
  it("joins lines per page", async () => {
    const extractor = createTextractExtractor({ client: fakeTextract([
      { type: "PAGE", page: 1 }, { type: "LINE", text: "City Water", page: 1 },
      { type: "LINE", text: "EUR 42.50", page: 1 }, { type: "PAGE", page: 2 },
      { type: "LINE", text: "Page two", page: 2 }
    ]) });
    const texts = await extractor([`data:image/png;base64,${png}`], "mail");
    expect(texts).toEqual(["City Water\nEUR 42.50", "Page two"]);
  });

  it("returns an empty string for a document with no text", async () => {
    const extractor = createTextractExtractor({ client: fakeTextract([{ type: "PAGE", page: 1 }]) });
    expect(await extractor([`data:image/png;base64,${png}`], "mail")).toEqual([""]);
  });

  it("rejects unsupported image formats", async () => {
    const extractor = createTextractExtractor({ client: fakeTextract([]) });
    await expect(extractor(["data:image/webp;base64,AAAA"], "mail")).rejects.toThrow(/Textract/);
  });

  it("rejects oversized documents", async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64");
    const extractor = createTextractExtractor({ client: fakeTextract([]) });
    await expect(extractor([`data:image/png;base64,${big}`], "mail")).rejects.toThrow(/too large/);
  });

  it("propagates client errors", async () => {
    const client: TextractLike = { async detectDocumentText() { throw new Error("ThrottlingException"); } };
    const extractor = createTextractExtractor({ client });
    await expect(extractor([`data:image/png;base64,${png}`], "mail")).rejects.toThrow(/ThrottlingException/);
  });
});
