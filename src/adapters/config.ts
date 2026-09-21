import type { Preferences } from "../domain/model.js";

export type NotifierConfig =
  | { kind: "null" }
  | { kind: "webhook"; url: string; allowlist: string[]; timeoutMs: number };
export type CalendarConfig = { kind: "null" } | { kind: "ics"; dir: string };
export type PaymentConfig = { kind: "null" } | { kind: "epc" };

export interface AdapterConfig {
  notifier: NotifierConfig;
  calendar: CalendarConfig;
  payment: PaymentConfig;
  signature: { kind: "local" };
  documentSource: { kind: "null" };
  assist: { kind: "null" };
  warnings: string[];
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function resolveAdapterConfig(
  env: NodeJS.ProcessEnv,
  prefs?: Preferences["adapters"]
): AdapterConfig {
  const warnings: string[] = [];

  const notifierKind = env.WAYFINDER_ADAPTER_NOTIFIER ?? prefs?.notifier;
  let notifier: NotifierConfig = { kind: "null" };
  if (notifierKind === "webhook") {
    const url = env.WAYFINDER_WEBHOOK_URL ?? "";
    const allowlist = (env.WAYFINDER_WEBHOOK_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!url) warnings.push("WAYFINDER_WEBHOOK_URL is required for the webhook notifier; staying null.");
    else if (!isHttps(url)) warnings.push("The webhook notifier requires an https URL; staying null.");
    else if (!allowlist.includes(url))
      warnings.push("The webhook URL is not in WAYFINDER_WEBHOOK_ALLOWLIST; staying null.");
    else
      notifier = {
        kind: "webhook",
        url,
        allowlist,
        timeoutMs: Number(env.WAYFINDER_ADAPTER_TIMEOUT_MS ?? 5000)
      };
  }

  const calendarKind = env.WAYFINDER_ADAPTER_CALENDAR ?? prefs?.calendar;
  let calendar: CalendarConfig = { kind: "null" };
  if (calendarKind === "ics") {
    const dir = env.WAYFINDER_ICS_DIR ?? "";
    if (!dir) warnings.push("WAYFINDER_ICS_DIR is required for the ICS sink; staying null.");
    else calendar = { kind: "ics", dir };
  }

  const paymentKind = env.WAYFINDER_ADAPTER_PAYMENT ?? prefs?.payment;
  const payment: PaymentConfig = paymentKind === "epc" ? { kind: "epc" } : { kind: "null" };

  return {
    notifier,
    calendar,
    payment,
    signature: { kind: "local" },
    documentSource: { kind: "null" },
    assist: { kind: "null" },
    warnings
  };
}
