import { randomUUID } from "node:crypto";
import type { Store } from "../storage/types.js";
import type { LedgerEntry, LedgerEvent } from "./model.js";
import { appendLedgerEntry, verifyLedger } from "./ledger.js";

export type LedgerStore = Pick<Store, "listLedger" | "putLedgerEntry">;

export interface LedgerAppendInput {
  at: string;
  actor: "agent" | "user";
  event: LedgerEvent;
  documentId?: string;
  threadKey?: string;
  details?: Record<string, unknown>;
  entryId?: string;
}

export interface Ledger {
  append(input: LedgerAppendInput): Promise<LedgerEntry>;
  read(): Promise<LedgerEntry[]>;
  verify(): Promise<{ ok: boolean; entries: number; firstMismatchSeq?: number }>;
}

const instances = new WeakMap<LedgerStore, Ledger>();

export function createLedger(store: LedgerStore): Ledger {
  const existing = instances.get(store);
  if (existing) return existing;

  let tail: Promise<unknown> = Promise.resolve();

  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  const ledger: Ledger = {
    append(input) {
      return serialize(async () => {
        const entries = await store.listLedger();
        const entry = appendLedgerEntry(entries, {
          entryId: input.entryId ?? `led_${randomUUID().slice(0, 8)}`,
          at: input.at,
          actor: input.actor,
          event: input.event,
          ...(input.documentId !== undefined ? { documentId: input.documentId } : {}),
          ...(input.threadKey !== undefined ? { threadKey: input.threadKey } : {}),
          ...(input.details !== undefined ? { details: input.details } : {})
        });
        await store.putLedgerEntry(entry);
        return entry;
      });
    },
    read() {
      return serialize(() => store.listLedger());
    },
    async verify() {
      return verifyLedger(await ledger.read());
    }
  };

  instances.set(store, ledger);
  return ledger;
}
