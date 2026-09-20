import { createHash } from "node:crypto";
import type { LedgerEntry, LedgerEvent } from "./model.js";
import { redactSensitive } from "./redact.js";

const GENESIS = "0".repeat(64);

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortValue(v)])
    );
  }
  return value;
}

export function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function hashEntry(prevHash: string, entry: Omit<LedgerEntry, "hash">): string {
  return createHash("sha256").update(`${prevHash}\n${canonicalJSON(entry)}`).digest("hex");
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactSensitive(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactValue(nested);
    }
    return out;
  }
  return value;
}

function redactDetails(details: Record<string, unknown>): Record<string, unknown> {
  return redactValue(details) as Record<string, unknown>;
}

export function appendLedgerEntry(
  entries: LedgerEntry[],
  input: {
    entryId: string;
    at: string;
    actor: "agent" | "user";
    event: LedgerEvent;
    documentId?: string;
    threadKey?: string;
    details?: Record<string, unknown>;
  }
): LedgerEntry {
  const prev = entries[entries.length - 1];
  const prevHash = prev ? prev.hash : GENESIS;
  const withoutHash: Omit<LedgerEntry, "hash"> = {
    seq: entries.length + 1,
    entryId: input.entryId,
    at: input.at,
    actor: input.actor,
    event: input.event,
    details: redactDetails(input.details ?? {}),
    prevHash,
    ...(input.documentId !== undefined ? { documentId: input.documentId } : {}),
    ...(input.threadKey !== undefined ? { threadKey: input.threadKey } : {})
  };
  return { ...withoutHash, hash: hashEntry(prevHash, withoutHash) };
}

export function verifyLedger(entries: LedgerEntry[]): { ok: boolean; entries: number; firstMismatchSeq?: number } {
  let prevHash = GENESIS;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    if (entry.seq !== i + 1 || entry.prevHash !== prevHash) {
      return { ok: false, entries: entries.length, firstMismatchSeq: i + 1 };
    }
    const { hash, ...withoutHash } = entry;
    if (hashEntry(prevHash, withoutHash) !== hash) {
      return { ok: false, entries: entries.length, firstMismatchSeq: i + 1 };
    }
    prevHash = hash;
  }
  return { ok: true, entries: entries.length };
}

export function buildRecordReport(entries: LedgerEntry[], range: { from?: string; to?: string }): string {
  const inRange = entries.filter((e) => (!range.from || e.at >= range.from) && (!range.to || e.at <= range.to));
  const lines = inRange.map((e) => {
    const target = e.documentId ?? e.threadKey ?? "";
    return `- ${e.at} ${e.event} ${target} ${canonicalJSON(e.details)}`;
  });
  const terminal = entries[entries.length - 1]?.hash ?? GENESIS;
  return [
    "# Wayfinder record",
    "",
    `Entries: ${inRange.length} of ${entries.length}`,
    ...lines,
    "",
    `Terminal hash: ${terminal}`,
    "Verify: run verify_ledger. This proves the record is internally consistent and unaltered; it is not a legal attestation."
  ].join("\n");
}
