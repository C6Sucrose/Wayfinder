import type { Store } from "../storage/types.js";
import type { DocumentRecord, Thread } from "./model.js";
import { buildThreads, toDocumentRecord } from "./correlation.js";

export interface BacklogEntry {
  thread: Thread;
  documents: DocumentRecord[];
  deadline?: string;
}

const URGENCY_RANK: Record<Thread["urgency"], number> = { high: 0, medium: 1, low: 2 };

export async function buildBacklog(store: Store, now: Date): Promise<BacklogEntry[]> {
  const records = (await store.listItems("all")).map(toDocumentRecord);
  return buildThreads(records, now)
    .map((thread) => {
      const documents = records.filter((r) => r.record.threadKey === thread.threadKey);
      const deadlines = documents
        .flatMap((d) => d.record.demands)
        .map((d) => d.deadline)
        .filter((d): d is string => typeof d === "string")
        .sort();
      const deadline = deadlines[0];
      return { thread, documents, ...(deadline !== undefined ? { deadline } : {}) };
    })
    .sort(
      (a, b) =>
        Number(b.thread.outstanding) - Number(a.thread.outstanding) ||
        URGENCY_RANK[a.thread.urgency] - URGENCY_RANK[b.thread.urgency] ||
        a.thread.firstSeenAt.localeCompare(b.thread.firstSeenAt)
    );
}

export function describeThread(thread: Thread, deadline?: string): string {
  const who = thread.sender || "an unknown sender";
  const what = thread.demandType === "none"
    ? "a document"
    : `${thread.demandType === "appointment" ? "an" : "a"} ${thread.demandType}`;
  const when = deadline !== undefined ? ` due ${deadline}` : "";
  const reminders = thread.reminderCount > 0 ? `, ${thread.reminderCount} reminder(s)` : "";
  return `${who}: ${what}${when}${reminders}`;
}
