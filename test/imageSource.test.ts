import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadImage } from "../src/scan/imageSource.js";

describe("loadImage", () => {
  it("loads a data URL and infers the format", async () => {
    const png = "iVBORw0KGgo="; // 1x1-ish PNG header bytes, base64
    const img = await loadImage(`data:image/png;base64,${png}`);
    expect(img.format).toBe("png");
    expect(img.bytes.length).toBeGreaterThan(0);
  });

  it("loads a local file and infers the format from the extension", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-"));
    const file = join(dir, "photo.jpg");
    writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    const img = await loadImage(file);
    expect(img.format).toBe("jpeg");
    expect(img.bytes.length).toBe(4);
  });

  it("rejects an unsupported reference", async () => {
    await expect(loadImage("ftp://example.com/x.jpg")).rejects.toThrow();
    await expect(loadImage("no-extension-file")).rejects.toThrow();
  });
});
