import { readFile } from "node:fs/promises";
import { extname } from "node:path";

export interface LoadedImage {
  bytes: Uint8Array;
  format: "jpeg" | "png" | "gif" | "webp";
}

const EXTENSIONS: Record<string, LoadedImage["format"]> = {
  ".jpg": "jpeg", ".jpeg": "jpeg", ".png": "png", ".gif": "gif", ".webp": "webp"
};
const MIME: Record<string, LoadedImage["format"]> = {
  "image/jpeg": "jpeg", "image/png": "png", "image/gif": "gif", "image/webp": "webp"
};

export async function loadImage(ref: string): Promise<LoadedImage> {
  if (ref.startsWith("data:")) {
    const match = ref.match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) throw new Error("Unsupported data URL.");
    const format = MIME[match[1]!.toLowerCase()];
    if (!format) throw new Error(`Unsupported image type: ${match[1]}`);
    return { bytes: new Uint8Array(Buffer.from(match[2]!, "base64")), format };
  }
  const format = EXTENSIONS[extname(ref).toLowerCase()];
  if (!format) throw new Error("Unsupported image reference.");
  return { bytes: new Uint8Array(await readFile(ref)), format };
}
