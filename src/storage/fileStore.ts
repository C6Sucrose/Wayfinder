import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Store } from "./types.js";
import { PreferencesSchema, type Action, type Item, type Scan, type StoredObject } from "../domain/model.js";

const ID_PATTERN = /^[a-z]+_[a-z0-9-]{1,64}$/;

export function assertSafeId(id: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new Error(`Invalid id: ${id}`);
  }
}

export function createFileStore(dir: string): Store {
  const itemsDir = join(dir, "items");
  const scansDir = join(dir, "scans");
  const actionsDir = join(dir, "actions");
  mkdirSync(itemsDir, { recursive: true });
  mkdirSync(scansDir, { recursive: true });
  mkdirSync(actionsDir, { recursive: true });

  const readJson = <T>(p: string): T | null => {
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, "utf8")) as T;
    } catch (err) {
      console.error(`[fileStore] skipping unreadable file ${p}:`, err);
      return null;
    }
  };
  const writeJson = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 2), "utf8");
  const readActions = (itemId: string): Action[] => {
    assertSafeId(itemId);
    const v = readJson<Action[]>(join(actionsDir, `${itemId}.json`));
    return Array.isArray(v) ? v : [];
  };
  const isFlagged = (item: Item): boolean =>
    item.class === "scam" ||
    readActions(item.itemId).some((a) => a.type === "flag" && (a.status === "done" || a.status === "confirmed"));

  return {
    async putScan(s) { assertSafeId(s.scanId); writeJson(join(scansDir, `${s.scanId}.json`), s); },
    async getScan(id) { assertSafeId(id); return readJson<Scan>(join(scansDir, `${id}.json`)); },
    async putItem(i) { assertSafeId(i.itemId); writeJson(join(itemsDir, `${i.itemId}.json`), i); },
    async getItem(id) { assertSafeId(id); return readJson<Item>(join(itemsDir, `${id}.json`)); },
    async deleteItem(id) { assertSafeId(id); rmSync(join(itemsDir, `${id}.json`), { force: true }); },
    async listItems(filter) {
      const all = readdirSync(itemsDir)
        .map((f) => readJson<Item>(join(itemsDir, f)))
        .filter((i): i is Item => i !== null);
      if (filter === "all") return all;
      if (filter === "unresolved") return all.filter((i) => i.resolvedAt === null);
      if (filter === "flagged") return all.filter(isFlagged);
      const today = new Date().toISOString().slice(0, 10);
      return all.filter((i) => i.resolvedAt === null && i.fields.dueDate !== undefined && i.fields.dueDate <= today);
    },
    async putAction(a) {
      assertSafeId(a.itemId);
      const existing = readActions(a.itemId).filter((x) => x.actionId !== a.actionId);
      existing.push(a);
      writeJson(join(actionsDir, `${a.itemId}.json`), existing);
    },
    async listActions(itemId) { return readActions(itemId); },
    async putObject(o) { assertSafeId(o.objectId); writeJson(join(dir, `object-${o.objectId}.json`), o); },
    async listObjects() {
      return readdirSync(dir).filter((f) => f.startsWith("object-"))
        .map((f) => readJson<StoredObject>(join(dir, f)))
        .filter((o): o is StoredObject => o !== null);
    },
    async getPreferences() { return PreferencesSchema.parse(readJson(join(dir, "preferences.json")) ?? {}); },
    async putPreferences(p) { writeJson(join(dir, "preferences.json"), p); }
  };
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}
