import type { Store } from "../storage/types.js";
import { StoredObjectSchema, type StoredObject } from "./model.js";
import { randomUUID } from "node:crypto";

export interface RememberInput { name: string; locationNote: string; imageRef?: string }

export async function rememberObject(store: Store, input: RememberInput): Promise<StoredObject> {
  const obj = StoredObjectSchema.parse({
    objectId: `obj_${randomUUID().slice(0, 8)}`,
    name: input.name,
    locationNote: input.locationNote,
    lastSeenAt: new Date().toISOString(),
    ...(input.imageRef ? { imageRef: input.imageRef } : {})
  });
  await store.putObject(obj);
  return obj;
}

export async function findObject(store: Store, name: string): Promise<StoredObject | null> {
  const target = name.trim().toLowerCase();
  const matches = (await store.listObjects())
    .filter((o) => o.name.trim().toLowerCase() === target)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  return matches[0] ?? null;
}
