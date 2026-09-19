import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Store } from "./types.js";
import { PreferencesSchema, type Item, type Scan } from "../domain/model.js";

export function createFileStore(dir: string): Store {
  const itemsDir = join(dir, "items");
  const scansDir = join(dir, "scans");
  mkdirSync(itemsDir, { recursive: true });
  mkdirSync(scansDir, { recursive: true });

  const readJson = <T>(p: string): T | null => (existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null);
  const writeJson = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 2), "utf8");

  return {
    async putScan(s) { writeJson(join(scansDir, `${s.scanId}.json`), s); },
    async getScan(id) { return readJson<Scan>(join(scansDir, `${id}.json`)); },
    async putItem(i) { writeJson(join(itemsDir, `${i.itemId}.json`), i); },
    async getItem(id) { return readJson<Item>(join(itemsDir, `${id}.json`)); },
    async listItems(filter) {
      const all = readdirSync(itemsDir).map((f) => readJson<Item>(join(itemsDir, f))!).filter(Boolean);
      if (filter === "all") return all;
      if (filter === "unresolved") return all.filter((i) => i.resolvedAt === null);
      if (filter === "flagged") return all.filter((i) => i.class === "scam");
      const today = new Date().toISOString().slice(0, 10);
      return all.filter((i) => i.fields.dueDate !== undefined && i.fields.dueDate <= today);
    },
    async putAction() { /* actions are stored on items in this plan */ },
    async listActions() { return []; },
    async putObject(o) { writeJson(join(dir, `object-${o.objectId}.json`), o); },
    async listObjects() {
      return readdirSync(dir).filter((f) => f.startsWith("object-"))
        .map((f) => readJson<import("../domain/model.js").StoredObject>(join(dir, f))!).filter(Boolean);
    },
    async getPreferences() {
      return PreferencesSchema.parse(readJson(join(dir, "preferences.json")) ?? {});
    },
    async putPreferences(p) { writeJson(join(dir, "preferences.json"), p); }
  };
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}
