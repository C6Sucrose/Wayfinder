import { existsSync } from "node:fs";
import { createFileStore } from "../src/storage/fileStore.js";
import { verifyLedger } from "../src/domain/ledger.js";
import { buildBacklog } from "../src/domain/backlog.js";

const dir = process.env.WAYFINDER_DATA_DIR ?? "data";
const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST?.trim() || "127.0.0.1";

const results: Array<{ level: "PASS" | "FAIL" | "WARN"; text: string }> = [];
const pass = (text: string): void => { results.push({ level: "PASS", text }); };
const fail = (text: string): void => { results.push({ level: "FAIL", text }); };
const warn = (text: string): void => { results.push({ level: "WARN", text }); };

if (!existsSync(dir)) {
  fail(`data directory missing: ${dir} (run: npm run seed:demo)`);
} else {
  const store = createFileStore(dir);
  const items = await store.listItems("all");
  const objects = await store.listObjects();
  const ledger = await store.listLedger();
  const preferences = await store.getPreferences();
  const verification = verifyLedger(ledger);

  if (items.length >= 5) pass(`items: ${items.length}`);
  else fail(`items: ${items.length} (expected a seeded demo; run: npm run seed:demo)`);

  const scams = items.filter((item) => item.class === "scam").length;
  if (scams >= 1) pass(`flagged scam: ${scams}`);
  else fail("no scam item in the data; the flagged beat will be empty");

  const lowConfidence = items.filter((item) => item.record?.confidence === "low").length;
  if (lowConfidence >= 1) pass(`low-confidence documents: ${lowConfidence}`);
  else warn("no low-confidence document; the recapture beat will be empty");

  const waterThreads = new Set(items.filter((item) => item.fields.sender === "City Water").map((item) => item.record?.threadKey));
  if (waterThreads.size === 1 && items.filter((item) => item.fields.sender === "City Water").length >= 3) {
    pass("water thread: 3 documents in one thread");
  } else {
    warn("water thread is not seeded as expected; the backlog beat may look thin");
  }

  const backlog = await buildBacklog(store, new Date());
  const top = backlog[0];
  if (top && top.thread.urgency === "high" && top.thread.reminderCount >= 2) {
    pass(`backlog top: ${top.thread.sender}, ${top.thread.reminderCount} reminders, ${top.thread.urgency} urgency, due ${top.deadline ?? "n/a"}`);
  } else if (top) {
    warn(`backlog top is ${top.thread.sender} (${top.thread.urgency}, ${top.thread.reminderCount} reminders); the script expects the water thread on top`);
  } else {
    fail("backlog is empty; the triage beat will have nothing to show");
  }

  if (objects.some((object) => object.name === "keys")) pass("object memory: keys present");
  else fail("keys object missing; the object-memory beat will be empty");

  if (verification.ok) pass(`ledger: ${verification.entries} entries, chain verified`);
  else fail(`ledger does not verify at entry ${verification.firstMismatchSeq ?? "?"}`);

  if (preferences.trustedContactAlias) pass(`trusted contact: ${preferences.trustedContactAlias}`);
  else warn("no trusted contact; the escalate step will decline");

  const authority = preferences.authority;
  if (authority && authority.forbidden.length > 0) pass(`authority: forbidden ${authority.forbidden.join(", ")}`);
  else warn("no forbidden action types; the refusal beat will not fire");
}

const get = async (path: string): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(`http://${host}:${port}${path}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

try {
  const health = (await get("/healthz")) as { ok?: boolean };
  pass(`server: ${health.ok === true ? "healthy" : "responded"}`);
  const capabilities = (await get("/capabilities")) as {
    brain?: { provider?: string };
    vision?: { provider?: string };
    channels?: { alexa?: string };
  };
  pass(`brain: ${capabilities.brain?.provider ?? "unknown"}; vision: ${capabilities.vision?.provider ?? "unknown"}; alexa: ${capabilities.channels?.alexa ?? "unknown"}`);
} catch {
  warn(`server not reachable at http://${host}:${port} (start it before recording)`);
}

for (const result of results) {
  const marker = result.level === "PASS" ? "PASS" : result.level === "FAIL" ? "FAIL" : "WARN";
  console.log(`${marker}  ${result.text}`);
}

const failures = results.filter((result) => result.level === "FAIL").length;
console.log(failures === 0 ? "\nPre-flight OK. You can record." : `\n${failures} pre-flight failure(s). Fix them before recording.`);
process.exit(failures === 0 ? 0 : 1);
