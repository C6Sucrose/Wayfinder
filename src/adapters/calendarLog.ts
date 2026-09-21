import type { Store } from "../storage/types.js";
import { createLedger } from "../domain/ledgerLog.js";
import type { CalendarPublishInput, CalendarSink } from "./types.js";

export async function publishCalendar(
  deps: { calendar: CalendarSink; store: Store },
  input: CalendarPublishInput
): Promise<{ delivered: boolean }> {
  let delivered = false;
  try {
    await deps.calendar.publish(input);
    delivered = true;
  } catch (err) {
    console.error("[calendarLog] publish failed:", err);
  }
  try {
    await createLedger(deps.store).append({
      at: new Date().toISOString(),
      actor: "agent",
      event: delivered ? "external_invoked" : "delivery_failed",
      details: { adapter: "calendar" }
    });
  } catch (err) {
    console.error("[calendarLog] failed to record calendar outcome:", err);
  }
  return { delivered };
}
