import type { AdapterConfig } from "./config.js";
import { nullAdapters, localSignature } from "./null.js";
import { epcPayment } from "./epcQr.js";
import { createIcsFileSink } from "./icsFileSink.js";
import { createWebhookNotifier } from "./webhookNotifier.js";
import type { AdapterBundle } from "./types.js";

export function createAdapters(config: AdapterConfig, deps: { fetchImpl?: typeof fetch } = {}): AdapterBundle {
  const notifier = config.notifier.kind === "webhook"
    ? createWebhookNotifier({
        url: config.notifier.url,
        allowlist: config.notifier.allowlist,
        timeoutMs: config.notifier.timeoutMs,
        ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {})
      })
    : nullAdapters.notifier;

  const calendar = config.calendar.kind === "ics"
    ? createIcsFileSink({ dir: config.calendar.dir })
    : nullAdapters.calendar;

  const payment = config.payment.kind === "epc" ? epcPayment : nullAdapters.payment;

  return {
    notifier,
    calendar,
    payment,
    signature: localSignature,
    documentSource: nullAdapters.documentSource,
    assist: nullAdapters.assist
  };
}
