import { createHash } from "node:crypto";
import type { Demand, DocClass, DocumentRecord, Fields, Item, Thread } from "./model.js";

const REMINDER = /\b(reminder|second reminder|third reminder|final notice|overdue)\b/i;
const SUPERSEDING = /\b(replaces|supersedes|correction|updated|revised)\b/i;

export function demandTypeFor(cls: DocClass): Demand["type"] | null {
  if (cls === "bill") return "payment";
  if (cls === "appointment") return "appointment";
  if (cls === "insurance" || cls === "government" || cls === "personal") return "reply";
  return null;
}

export function threadKeyFor(fields: Fields, demandType: string): string {
  const sender = (fields.sender ?? "").trim().toLowerCase();
  const reference = (fields.reference ?? "").trim().toLowerCase();
  const parts = reference ? [sender, reference, demandType] : [sender, demandType];
  return `t_${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 12)}`;
}

export function isReminderText(text: string): boolean {
  return REMINDER.test(text);
}

export function isSupersedingText(text: string): boolean {
  return SUPERSEDING.test(text);
}

export function toDocumentRecord(item: Item): DocumentRecord {
  if (item.record) return item as DocumentRecord;
  const type = demandTypeFor(item.class);
  const deadline = item.fields.dueDate ?? item.fields.appointmentAt;
  const demands: Demand[] = type ? [{ type, ...(deadline ? { deadline } : {}) }] : [];
  const threadKey = threadKeyFor(item.fields, type ?? "none");
  return {
    ...item,
    record: {
      lifecycle: item.resolvedAt ? "closed" : "open",
      confidence: "high",
      needsRecapture: false,
      demands,
      threadKey
    }
  };
}

export function threadUrgency(
  thread: Pick<Thread, "reminderCount" | "outstanding">,
  deadline: string | undefined,
  now: Date
): Thread["urgency"] {
  if (!thread.outstanding) return "low";
  const days = deadline ? (new Date(deadline).getTime() - now.getTime()) / 86_400_000 : undefined;
  if (days !== undefined && days <= 3) return "high";
  if (thread.reminderCount >= 2) return "high";
  if (days !== undefined && days <= 14) return "medium";
  return "low";
}

export function buildThreads(records: DocumentRecord[], now: Date): Thread[] {
  const grouped = new Map<string, DocumentRecord[]>();
  for (const record of records) {
    const list = grouped.get(record.record.threadKey) ?? [];
    list.push(record);
    grouped.set(record.record.threadKey, list);
  }

  return [...grouped.entries()].map(([threadKey, docs]) => {
    const sorted = [...docs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const demand = docs.find((d) => d.record.demands[0])?.record.demands[0];
    const deadline = docs
      .flatMap((d) => d.record.demands)
      .map((d) => d.deadline)
      .filter((d): d is string => typeof d === "string")
      .sort()[0];
    const reminderCount = docs.filter((d) => isReminderText(d.readAloudText)).length;
    const outstanding = docs.some((d) => d.record.lifecycle !== "closed" && d.record.lifecycle !== "confirmed");
    const urgency = threadUrgency({ reminderCount, outstanding }, deadline, now);
    return {
      threadKey,
      sender: docs.find((d) => d.fields.sender)?.fields.sender ?? "",
      demandType: demand?.type ?? "none",
      documentIds: sorted.map((d) => d.itemId),
      firstSeenAt: sorted[0]!.createdAt,
      lastSeenAt: sorted[sorted.length - 1]!.createdAt,
      reminderCount,
      urgency,
      outstanding
    };
  });
}
