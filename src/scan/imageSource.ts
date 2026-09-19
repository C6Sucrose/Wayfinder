import { readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

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

export async function loadImage(ref: string, options?: { root?: string }): Promise<LoadedImage> {
  if (ref.startsWith("data:")) {
    const match = ref.match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) throw new Error("Unsupported data URL.");
    const format = MIME[match[1]!.toLowerCase()];
    if (!format) throw new Error(`Unsupported image type: ${match[1]}`);
    return { bytes: new Uint8Array(Buffer.from(match[2]!, "base64")), format };
  }
  const format = EXTENSIONS[extname(ref).toLowerCase()];
  if (!format) throw new Error("Unsupported image reference.");
  const root = options?.root;
  if (!root) throw new Error("Local image references are disabled.");
  const canonicalRoot = await realpath(resolve(root));
  let canonicalTarget: string;
  try {
    canonicalTarget = await realpath(resolve(root, ref));
  } catch {
    throw new Error(`Local image is not readable: ${ref}`);
  }
  const rel = relative(canonicalRoot, canonicalTarget);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Local image reference is outside the allowed capture root.");
  }
  return { bytes: new Uint8Array(await readFile(canonicalTarget)), format };
}
