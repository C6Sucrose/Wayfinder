import type { Item, Lifecycle } from "./model.js";
import { toDocumentRecord } from "./correlation.js";

export function lifecycleOf(item: Item): Lifecycle {
  return (item.record ?? toDocumentRecord(item).record).lifecycle;
}

export function withLifecycle(item: Item, lifecycle: Lifecycle, at: string): Item {
  const base = toDocumentRecord(item);
  const firstClose = lifecycle === "closed" && item.resolvedAt === null;
  return {
    ...base,
    resolvedAt: firstClose ? at : item.resolvedAt,
    record: { ...base.record, lifecycle }
  };
}
