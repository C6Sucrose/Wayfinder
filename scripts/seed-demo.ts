import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createFileStore } from "../src/storage/fileStore.js";
import { threadKeyFor } from "../src/domain/correlation.js";
import { appendLedgerEntry } from "../src/domain/ledger.js";
import type { Action, DocumentState, Item, LedgerEntry } from "../src/domain/model.js";

const dir = process.env.WAYFINDER_DATA_DIR ?? "data";
const keep = process.argv.includes("--keep");

if (!keep) {
  for (const sub of ["items", "scans", "actions"]) rmSync(join(dir, sub), { recursive: true, force: true });
  rmSync(join(dir, "ledger.json"), { force: true });
  for (const file of ["preferences.json"]) rmSync(join(dir, file), { force: true });
  for (const entry of ["keys", "wallet", "glasses"]) rmSync(join(dir, `object-obj_${entry}.json`), { force: true });
}
mkdirSync(dir, { recursive: true });

const store = createFileStore(dir);
const now = new Date();

const iso = (days: number): string => {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
};
const day = (days: number): string => iso(days).slice(0, 10);

const action = (itemId: string, actionId: string, type: Action["type"], params: Record<string, unknown> = {}): Action => ({
  itemId,
  actionId,
  type,
  params,
  status: "proposed"
});

interface Seed {
  itemId: string;
  class: Item["class"];
  confidence: number;
  readAloudText: string;
  fields: Item["fields"];
  actions: Action[];
  createdDaysAgo: number;
  lifecycle: DocumentState["lifecycle"];
  lowConfidence?: boolean;
  needsRecapture?: boolean;
  demandType: "payment" | "reply" | "appointment";
  deadline?: string;
  supersedes?: string;
  supersededBy?: string;
}

const waterRef = "INV-8842";
const waterKey = threadKeyFor({ sender: "City Water", reference: waterRef }, "payment");
const hospitalRef = "APPT-77";
const hospitalKey = threadKeyFor({ sender: "St Mary's Hospital", reference: hospitalRef }, "appointment");

const seeds: Seed[] = [
  {
    itemId: "itm_water-1",
    class: "bill",
    confidence: 0.93,
    readAloudText: "City Water bill for 42 euro 50, due Friday. This is a reminder.",
    fields: { sender: "City Water", reference: waterRef, dueDate: day(2), amount: { value: 42.5, currency: "EUR" } },
    actions: [action("itm_water-1", "a_remind", "remind", { on: day(2) }), action("itm_water-1", "a_file", "file")],
    createdDaysAgo: 21,
    lifecycle: "awaiting_action",
    demandType: "payment",
    deadline: day(2)
  },
  {
    itemId: "itm_water-2",
    class: "bill",
    confidence: 0.91,
    readAloudText: "Second reminder from City Water for 42 euro 50, due Friday.",
    fields: { sender: "City Water", reference: waterRef, dueDate: day(2), amount: { value: 42.5, currency: "EUR" } },
    actions: [action("itm_water-2", "a_remind", "remind", { on: day(2) }), action("itm_water-2", "a_file", "file")],
    createdDaysAgo: 14,
    lifecycle: "awaiting_action",
    demandType: "payment",
    deadline: day(2)
  },
  {
    itemId: "itm_water-3",
    class: "bill",
    confidence: 0.95,
    readAloudText: "Third reminder and final notice from City Water for 42 euro 50, due Friday.",
    fields: { sender: "City Water", reference: waterRef, dueDate: day(2), amount: { value: 42.5, currency: "EUR" } },
    actions: [action("itm_water-3", "a_remind", "remind", { on: day(2) }), action("itm_water-3", "a_file", "file")],
    createdDaysAgo: 7,
    lifecycle: "awaiting_action",
    demandType: "payment",
    deadline: day(2)
  },
  {
    itemId: "itm_hospital-old",
    class: "appointment",
    confidence: 0.9,
    readAloudText: "St Mary's Hospital appointment on the 7th at 9 in the morning.",
    fields: { sender: "St Mary's Hospital", reference: hospitalRef, appointmentAt: iso(-7) },
    actions: [action("itm_hospital-old", "a_schedule", "schedule", { at: iso(-7) })],
    createdDaysAgo: 18,
    lifecycle: "closed",
    demandType: "appointment",
    supersededBy: "itm_hospital-new"
  },
  {
    itemId: "itm_hospital-new",
    class: "appointment",
    confidence: 0.94,
    readAloudText: "Correction from St Mary's Hospital: your appointment has moved to the 14th at 10.",
    fields: { sender: "St Mary's Hospital", reference: hospitalRef, appointmentAt: iso(5) },
    actions: [action("itm_hospital-new", "a_schedule", "schedule", { at: iso(5) }), action("itm_hospital-new", "a_file", "file")],
    createdDaysAgo: 3,
    lifecycle: "awaiting_action",
    demandType: "appointment",
    deadline: day(5),
    supersedes: "itm_hospital-old"
  },
  {
    itemId: "itm_scam",
    class: "scam",
    confidence: 0.35,
    readAloudText: "Claims to be your bank, asks you to pay a fine with gift cards today.",
    fields: { sender: "Your Bank", dueDate: day(1) },
    actions: [action("itm_scam", "a_flag", "flag"), action("itm_scam", "a_discard", "discard")],
    createdDaysAgo: 2,
    lifecycle: "open",
    lowConfidence: true,
    demandType: "reply",
    deadline: day(1)
  },
  {
    itemId: "itm_insurance",
    class: "insurance",
    confidence: 0.42,
    readAloudText: "Letter from Acme Insurance. The account number is blurred.",
    fields: { sender: "Acme Insurance", reference: "POL-9", dueDate: day(9) },
    actions: [action("itm_insurance", "a_file", "file"), action("itm_insurance", "a_share", "share")],
    createdDaysAgo: 1,
    lifecycle: "awaiting_action",
    lowConfidence: true,
    needsRecapture: true,
    demandType: "reply",
    deadline: day(9)
  },
  {
    itemId: "itm_junk",
    class: "junk",
    confidence: 0.88,
    readAloudText: "Takeaway menu for the pizza place on the corner.",
    fields: { sender: "Pizza Corner" },
    actions: [action("itm_junk", "a_discard", "discard")],
    createdDaysAgo: 4,
    lifecycle: "open",
    demandType: "reply"
  }
];

const itemFor = (seed: Seed, threadKey: string): Item => ({
  itemId: seed.itemId,
  scanId: "scn_demo",
  class: seed.class,
  confidence: seed.confidence,
  readAloudText: seed.readAloudText,
  fields: seed.fields,
  proposedActions: seed.actions,
  createdAt: iso(-seed.createdDaysAgo),
  resolvedAt: seed.lifecycle === "closed" ? iso(-seed.createdDaysAgo + 1) : null,
  record: {
    lifecycle: seed.lifecycle,
    confidence: seed.lowConfidence === true ? "low" : "high",
    needsRecapture: seed.needsRecapture === true,
    demands: [{ type: seed.demandType, ...(seed.deadline !== undefined ? { deadline: seed.deadline } : {}) }],
    threadKey,
    ...(seed.supersedes !== undefined ? { supersedes: seed.supersedes } : {}),
    ...(seed.supersededBy !== undefined ? { supersededBy: seed.supersededBy } : {})
  }
});

const threadFor = (seed: Seed): string => {
  if (seed.itemId.startsWith("itm_water")) return waterKey;
  if (seed.itemId.startsWith("itm_hospital")) return hospitalKey;
  return threadKeyFor(seed.fields, seed.demandType);
};

let ledger: LedgerEntry[] = [];

const record = (input: Parameters<typeof appendLedgerEntry>[1]): void => {
  const entry = appendLedgerEntry(ledger, input);
  ledger = [...ledger, entry];
};

for (const seed of seeds) {
  const threadKey = threadFor(seed);
  await store.putItem(itemFor(seed, threadKey));
  for (const proposed of seed.actions) await store.putAction(proposed);
  record({
    entryId: `evt_ing_${seed.itemId}`,
    at: iso(-seed.createdDaysAgo),
    actor: "agent",
    event: "ingested",
    documentId: seed.itemId,
    threadKey,
    details: { source: "demo-seed" }
  });
  record({
    entryId: `evt_tri_${seed.itemId}`,
    at: iso(-seed.createdDaysAgo),
    actor: "agent",
    event: "triaged",
    documentId: seed.itemId,
    threadKey,
    details: { actionType: "triage", class: seed.class }
  });
}

for (const entry of ledger) await store.putLedgerEntry(entry);

await store.putObject({
  objectId: "obj_keys",
  name: "keys",
  locationNote: "the kitchen counter",
  lastSeenAt: iso(-1)
});

await store.putPreferences({
  verbosity: "normal",
  trustedContactAlias: "Priya",
  largeText: false,
  locale: "en-US",
  authority: {
    autoActUpTo: { currency: "EUR", value: 50 },
    confirmAbove: { currency: "EUR", value: 50 },
    forbidden: ["discard_document", "share_personal_data"],
    onLowConfidence: "ask"
  }
});

console.log(`[seed] data dir: ${dir}${keep ? " (kept existing files)" : " (reset)"}`);
console.log(`[seed] items: ${seeds.length}, objects: 1, ledger entries: ${ledger.length}`);
console.log("[seed] demo beats ready:");
console.log("  - backlog: City Water thread, 3 reminders, due in 2 days");
console.log("  - briefing: scam flagged, low-confidence insurance letter needs recapture");
console.log("  - refusal: discarding the pizza menu or sharing the insurance letter is forbidden");
console.log("  - object memory: keys on the kitchen counter");
console.log("  - proof: verify_ledger over the seeded chain");
