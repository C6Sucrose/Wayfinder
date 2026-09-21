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
  const pending: NotifyJob[] = [];
  let active: Promise<void> | null = null;

  const deliver = async (job: NotifyJob): Promise<void> => {
    const summary = redactSensitive(job.summary);
    let delivered = false;
    try {
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

  const pump = async (): Promise<void> => {
    while (pending.length > 0) {
      const job = pending.shift()!;
      await deliver(job);
    }
  };

  return {
    enqueue(job) {
      pending.push(job);
      if (!active) {
        active = pump().finally(() => { active = null; });
      }
    },
    async drain() {
      while (active) await active;
    },
    async close() {
      await active;
    }
  };
}
