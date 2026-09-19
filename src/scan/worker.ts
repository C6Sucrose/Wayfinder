import type { Store } from "../storage/types.js";
import type { Scan } from "../domain/model.js";
import type { Extractor } from "../domain/scanPipeline.js";
import { processScan } from "../domain/scans.js";

export interface ScanWorker {
  enqueue(input: { scanId: string; imageRefs: string[]; hint: Scan["hint"] }): void;
  idle(): Promise<void>;
  close(): Promise<void>;
}

export function createScanWorker(deps: {
  store: Store;
  extract?: Extractor;
  onComplete?: (scanId: string) => void;
  concurrency?: number;
}): ScanWorker {
  const limit = Math.max(1, deps.concurrency ?? 1);
  const queue: Array<{ scanId: string; imageRefs: string[]; hint: Scan["hint"] }> = [];
  const running = new Set<string>();
  let active = 0;
  let closed = false;
  let drainResolvers: Array<() => void> = [];

  const settleIfIdle = () => {
    if (active === 0 && queue.length === 0) {
      drainResolvers.forEach((r) => r());
      drainResolvers = [];
    }
  };

  const run = async (task: { scanId: string; imageRefs: string[]; hint: Scan["hint"] }) => {
    active += 1;
    running.add(task.scanId);
    try {
      const texts = deps.extract ? await deps.extract(task.imageRefs, task.hint) : [];
      await processScan(deps.store, task.scanId, texts);
    } catch (err) {
      console.error(`[scanWorker] scan ${task.scanId} failed:`, err);
      const scan = await deps.store.getScan(task.scanId).catch(() => null);
      if (scan) await deps.store.putScan({ ...scan, status: "failed" }).catch(() => undefined);
    } finally {
      running.delete(task.scanId);
      active -= 1;
      deps.onComplete?.(task.scanId);
      pump();
      settleIfIdle();
    }
  };

  const pump = () => {
    if (closed) return;
    while (active < limit && queue.length > 0) {
      const next = queue.shift()!;
      void run(next);
    }
  };

  const idle = (): Promise<void> => {
    if (active === 0 && queue.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => { drainResolvers.push(resolve); });
  };

  return {
    enqueue(input) {
      if (closed) throw new Error("Worker is closed.");
      queue.push(input);
      pump();
    },
    idle,
    async close() {
      await idle();
      closed = true;
    }
  };
}
