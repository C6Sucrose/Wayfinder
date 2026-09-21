import type { LedgerEvent } from "../domain/model.js";

export interface NotifyInput {
  event: LedgerEvent;
  documentId?: string;
  threadKey?: string;
  summary: string; // already redacted by the caller
  entryId?: string; // originating ledger entry, for idempotency
}

export interface Notifier {
  notify(input: NotifyInput): Promise<{ delivered: boolean; detail: string }>;
}

export interface CalendarPublishInput {
  title: string;
  start: string;
  durationMinutes?: number;
  description?: string;
}

export interface CalendarSink {
  publish(input: CalendarPublishInput): Promise<{ ref: string }>;
}

export interface PaymentPrepareInput {
  amount: { currency: string; value: number };
  beneficiaryName: string;
  iban: string;
  remittance: string;
}

export interface PaymentHandoff {
  prepare(input: PaymentPrepareInput): { instruction: string; epcQr?: string; ledgerNote: string };
}

export interface SignatureProvider {
  attest(headHash: string): Promise<{ kind: "local" | "kms" | "tsa"; proof: string }>;
}

export interface DocumentSource {
  poll(cursor: string | undefined): Promise<{ imageRefs: string[]; texts: string[]; cursor: string }>;
}

export interface AssistProvider {
  request(input: { reason: string; documentId?: string }): Promise<{ sessionRef: string }>;
}

export interface AdapterBundle {
  notifier: Notifier;
  calendar: CalendarSink;
  payment: PaymentHandoff;
  signature: SignatureProvider;
  documentSource: DocumentSource;
  assist: AssistProvider;
}
