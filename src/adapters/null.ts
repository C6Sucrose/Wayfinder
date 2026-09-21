import type {
  AdapterBundle, AssistProvider, CalendarSink, DocumentSource, Notifier, PaymentHandoff, SignatureProvider
} from "./types.js";

export const nullNotifier: Notifier = {
  async notify() { return { delivered: false, detail: "no notifier configured" }; }
};

export const nullCalendar: CalendarSink = {
  async publish(input) { return { ref: `ledger:${input.title}` }; }
};

export const nullPayment: PaymentHandoff = {
  prepare(input) {
    const money = `${input.amount.currency} ${input.amount.value.toFixed(2)}`;
    return {
      instruction: `To pay ${money} to ${input.beneficiaryName}, use your banking app.`,
      ledgerNote: "Payment handoff: spoken instruction only; no payment was made."
    };
  }
};

export const localSignature: SignatureProvider = {
  async attest(headHash) { return { kind: "local", proof: headHash }; }
};

export const nullDocumentSource: DocumentSource = {
  async poll(cursor) { return { imageRefs: [], texts: [], cursor: cursor ?? "0" }; }
};

export const nullAssist: AssistProvider = {
  async request() { return { sessionRef: "none" }; }
};

export const nullAdapters: AdapterBundle = {
  notifier: nullNotifier,
  calendar: nullCalendar,
  payment: nullPayment,
  signature: localSignature,
  documentSource: nullDocumentSource,
  assist: nullAssist
};
