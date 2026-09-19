import { describe, it, expect } from "vitest";
import { createBedrockExtractor } from "../src/scan/bedrockExtractor.js";

const png = "iVBORw0KGgo=";

function fakeClient(response: unknown, capture: { commands: unknown[] }) {
  return { async send(command: unknown) { capture.commands.push(command); return response; } };
}

describe("createBedrockExtractor", () => {
  it("sends one image block per image and concatenates text output", async () => {
    const capture = { commands: [] as unknown[] };
    let call = 0;
    const client = {
      async send(command: unknown) {
        capture.commands.push(command);
        call += 1;
        return { output: { message: { content: [{ text: call === 1 ? "Amount due: €10." : "Payment due 2026-10-01." }] } } };
      }
    };
    const extract = createBedrockExtractor({ client, modelId: "test-model" });
    const texts = await extract([`data:image/png;base64,${png}`, `data:image/png;base64,${png}`], "mail");
    expect(texts).toEqual(["Amount due: €10.", "Payment due 2026-10-01."]);
    expect(capture.commands).toHaveLength(2);
    expect(JSON.stringify(capture.commands)).toContain("test-model");
  });

  it("throws when the client fails", async () => {
    const client = { async send() { throw new Error("access denied"); } };
    const extract = createBedrockExtractor({ client, modelId: "test-model" });
    await expect(extract([`data:image/png;base64,${png}`], "mail")).rejects.toThrow();
  });

  it("returns an empty text entry when the model returns no text", async () => {
    const client = fakeClient({ output: { message: { content: [] } } }, { commands: [] });
    const extract = createBedrockExtractor({ client, modelId: "test-model" });
    expect(await extract([`data:image/png;base64,${png}`], "mail")).toEqual([""]);
  });
});
