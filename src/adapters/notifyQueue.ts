import type { Store } from "../storage/types.js";
import { createLedger } from "../domain/ledgerLog.js";
import { redactSensitive } from "../domain/redact.js";
import type { LedgerEvent } from "../domain/model.js";
import type { Notifier } from "./types.js";

export interface NotifyJob {
  event: LedgerEvent;
  documentId?: string;
  threadKey?: string;
  summary: string;
  entryId?: string;
}

export interface NotifyQueue {
  enqueue(job: NotifyJob): void;
  drain(): Promise<void>;
  close(): Promise<void>;
}

export function createNotifyQueue(deps: { notifier: Notifier; store: Store }): NotifyQueue {
  const ledger = createLedger(deps.store);
  let tail: Promise<void> = Promise.resolve();

  const deliver = async (job: NotifyJob): Promise<void> => {
    let delivered = false;
    try {
      const summary = redactSensitive(job.summary);
      const result = await deps.notifier.notify({
        event: job.event,
        summary,
        ...(job.documentId !== undefined ? { documentId: job.documentId } : {}),
        ...(job.threadKey !== undefined ? { threadKey: job.threadKey } : {}),
        ...(job.entryId !== undefined ? { entryId: job.entryId } : {})
      });
      delivered = result.delivered;
    } catch (err) {
      console.error("[notifyQueue] notifier threw:", err);
    }
    const at = new Date().toISOString();
    try {
      await ledger.append({
        at,
        actor: "agent",
        event: delivered ? "external_invoked" : "delivery_failed",
        details: {
          adapter: "notifier",
          notifiedEvent: job.event,
          ...(job.entryId !== undefined ? { entryId: job.entryId } : {})
        },
        ...(job.documentId !== undefined ? { documentId: job.documentId } : {}),
        ...(job.threadKey !== undefined ? { threadKey: job.threadKey } : {})
      });
    } catch (err) {
      console.error("[notifyQueue] failed to record delivery outcome:", err);
    }
  };

  return {
    enqueue(job) {
      tail = tail.then(() => deliver(job)).catch((err) => {
        console.error("[notifyQueue] delivery task failed:", err);
      });
    },
    async drain() {
      let current = tail;
      await current;
      while (current !== tail) {
        current = tail;
        await current;
      }
    },
    async close() {
      await tail;
    }
  };
}
