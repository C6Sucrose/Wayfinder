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

  it("loads a local file inside the configured root and infers the format", async () => {
    const root = mkdtempSync(join(tmpdir(), "wf-"));
    writeFileSync(join(root, "photo.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    const img = await loadImage("photo.jpg", { root });
    expect(img.format).toBe("jpeg");
    expect(img.bytes.length).toBe(4);
  });

  it("loads an absolute path inside the configured root", async () => {
    const root = mkdtempSync(join(tmpdir(), "wf-"));
    const file = join(root, "photo.png");
    writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const img = await loadImage(file, { root });
    expect(img.format).toBe("png");
    expect(img.bytes.length).toBe(4);
  });

  it("rejects a local path outside the configured root", async () => {
    const root = mkdtempSync(join(tmpdir(), "wf-"));
    const outside = mkdtempSync(join(tmpdir(), "wf-outside-"));
    const file = join(outside, "secret.jpg");
    writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    await expect(loadImage(file, { root })).rejects.toThrow(/outside the allowed capture root/i);
  });

  it("rejects a local path when no root is configured", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "wf-")), "photo.jpg");
    writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    await expect(loadImage(file)).rejects.toThrow(/disabled/i);
  });

  it("rejects an unsupported reference", async () => {
    await expect(loadImage("ftp://example.com/x.jpg")).rejects.toThrow();
    await expect(loadImage("no-extension-file")).rejects.toThrow();
  });
});
