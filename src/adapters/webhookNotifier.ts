import { redactSensitive } from "../domain/redact.js";
import type { Notifier } from "./types.js";

export function createWebhookNotifier(deps: {
  url: string;
  allowlist: string[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Notifier {
  let protocol: string;
  try {
    protocol = new URL(deps.url).protocol;
  } catch {
    throw new Error("Webhook URL is not a valid URL.");
  }
  if (protocol !== "https:") throw new Error("The webhook notifier requires an https URL.");
  if (!deps.allowlist.includes(deps.url)) throw new Error("The webhook URL is not in the allowlist.");

  const timeoutMs = deps.timeoutMs ?? 5000;
  const doFetch = deps.fetchImpl ?? fetch;
  const sent = new Set<string>();

  return {
    async notify(input) {
      if (input.entryId !== undefined) {
        if (sent.has(input.entryId)) return { delivered: false, detail: "duplicate suppressed" };
        sent.add(input.entryId);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const payload = {
          entryId: input.entryId ?? null,
          event: input.event,
          documentId: input.documentId !== undefined ? redactSensitive(input.documentId) : null,
          threadKey: input.threadKey !== undefined ? redactSensitive(input.threadKey) : null,
          summary: redactSensitive(input.summary)
        };
        const response = await doFetch(deps.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        if (!response.ok) return { delivered: false, detail: `status ${response.status}` };
        return { delivered: true, detail: "delivered" };
      } catch (err) {
        return { delivered: false, detail: err instanceof Error ? err.message : "delivery error" };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
