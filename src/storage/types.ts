import type { Scan, Item, Action, StoredObject, Preferences, LedgerEntry } from "../domain/model.js";

export interface Store {
  putScan(s: Scan): Promise<void>;
  getScan(id: string): Promise<Scan | null>;
  putItem(i: Item): Promise<void>;
  getItem(id: string): Promise<Item | null>;
  deleteItem(id: string): Promise<void>;
  listItems(filter: "unresolved" | "due" | "flagged" | "all"): Promise<Item[]>;
  putAction(a: Action): Promise<void>;
  listActions(itemId: string): Promise<Action[]>;
  putObject(o: StoredObject): Promise<void>;
  listObjects(): Promise<StoredObject[]>;
  getPreferences(): Promise<Preferences>;
  putPreferences(p: Preferences): Promise<void>;
  listLedger(): Promise<LedgerEntry[]>;
  putLedgerEntry(e: LedgerEntry): Promise<void>;
}
