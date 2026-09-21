import { runCalendarContract, runNotifierContract, runPaymentContract } from "./contract.js";
import { nullAdapters } from "../../src/adapters/null.js";
import { epcPayment } from "../../src/adapters/epcQr.js";

runNotifierContract(() => nullAdapters.notifier);
runCalendarContract(() => nullAdapters.calendar);
runPaymentContract(() => nullAdapters.payment);
runPaymentContract(() => epcPayment);
