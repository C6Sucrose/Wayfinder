import { afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runAssistContract,
  runCalendarContract,
  runDocumentSourceContract,
  runNotifierContract,
  runPaymentContract,
  runSignatureContract
} from "./contract.js";
import { nullAdapters } from "../../src/adapters/null.js";
import { epcPayment } from "../../src/adapters/epcQr.js";
import { createWebhookNotifier } from "../../src/adapters/webhookNotifier.js";
import { createIcsFileSink } from "../../src/adapters/icsFileSink.js";

const webhookCalls: string[] = [];
const webhookFetch = (async (_url: string | URL, init?: { body?: unknown }) => {
  webhookCalls.push(String(init?.body));
  return { ok: true, status: 200 };
}) as unknown as typeof fetch;

const icsDir = mkdtempSync(join(tmpdir(), "wf-contract-"));
afterAll(() => {
  rmSync(icsDir, { recursive: true, force: true });
});

runNotifierContract("null", () => nullAdapters.notifier);
runNotifierContract(
  "webhook",
  () =>
    createWebhookNotifier({
      url: "https://hooks.example/wf",
      allowlist: ["https://hooks.example/wf"],
      fetchImpl: webhookFetch
    }),
  { expectsDelivery: true, lastBody: () => webhookCalls.at(-1) ?? "" }
);

runCalendarContract("null", () => nullAdapters.calendar);
runCalendarContract("ics", () =>
  createIcsFileSink({ dir: icsDir, now: () => "2026-09-20T12:00:00.000Z" })
);

runPaymentContract("null", () => nullAdapters.payment);
runPaymentContract("epc", () => epcPayment, { expectsEpcQr: true });

runSignatureContract("null", () => nullAdapters.signature);
runDocumentSourceContract("null", () => nullAdapters.documentSource);
runAssistContract("null", () => nullAdapters.assist);
