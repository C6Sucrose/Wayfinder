import { describe, it, expect } from "vitest";
import type {
  AssistProvider,
  CalendarSink,
  DocumentSource,
  Notifier,
  PaymentHandoff,
  SignatureProvider
} from "../../src/adapters/types.js";

export function runNotifierContract(label: string, make: () => Notifier): void {
  describe(`Notifier contract (${label})`, () => {
    it("never throws and returns a boolean delivered flag with a string detail", async () => {
      const result = await make().notify({ event: "triaged", summary: "contract summary" });
      expect(typeof result.delivered).toBe("boolean");
      expect(typeof result.detail).toBe("string");
    });
  });
}

export function runCalendarContract(label: string, make: () => CalendarSink): void {
  describe(`CalendarSink contract (${label})`, () => {
    it("returns a non-empty ref", async () => {
      const { ref } = await make().publish({ title: "Contract", start: "2026-10-01T09:00:00.000Z" });
      expect(ref.length).toBeGreaterThan(0);
    });
  });
}

export function runPaymentContract(
  label: string,
  make: () => PaymentHandoff,
  options: { expectsEpcQr?: boolean } = {}
): void {
  describe(`PaymentHandoff contract (${label})`, () => {
    it("returns a non-empty instruction and ledger note for a valid IBAN", () => {
      const result = make().prepare({
        amount: { currency: "EUR", value: 1 },
        beneficiaryName: "Contract",
        iban: "DE89370400440532013000",
        remittance: "R"
      });
      expect(result.instruction.length).toBeGreaterThan(0);
      expect(result.ledgerNote.length).toBeGreaterThan(0);
      if (options.expectsEpcQr === true) {
        expect(result.epcQr).toBeDefined();
        expect(result.epcQr?.length ?? 0).toBeGreaterThan(0);
      }
    });

    it("never produces an epcQr for an invalid IBAN (spec 9.3/acceptance)", () => {
      let epcQr: string | undefined;
      try {
        epcQr = make().prepare({
          amount: { currency: "EUR", value: 1 },
          beneficiaryName: "Contract",
          iban: "DE89370400440532013001",
          remittance: "R"
        }).epcQr;
      } catch {
        epcQr = undefined;
      }
      expect(epcQr).toBeUndefined();
    });
  });
}

export function runSignatureContract(label: string, make: () => SignatureProvider): void {
  describe(`SignatureProvider contract (${label})`, () => {
    it("attests a head hash with a known kind and a non-empty proof", async () => {
      const headHash = "a".repeat(64);
      const result = await make().attest(headHash);
      expect(["local", "kms", "tsa"]).toContain(result.kind);
      expect(result.proof.length).toBeGreaterThan(0);
    });
  });
}

export function runDocumentSourceContract(label: string, make: () => DocumentSource): void {
  describe(`DocumentSource contract (${label})`, () => {
    it("returns image refs, texts, and a string cursor without throwing", async () => {
      const result = await make().poll(undefined);
      expect(Array.isArray(result.imageRefs)).toBe(true);
      expect(Array.isArray(result.texts)).toBe(true);
      expect(typeof result.cursor).toBe("string");
    });
  });
}

export function runAssistContract(label: string, make: () => AssistProvider): void {
  describe(`AssistProvider contract (${label})`, () => {
    it("returns a non-empty session ref without throwing", async () => {
      const result = await make().request({ reason: "contract" });
      expect(result.sessionRef.length).toBeGreaterThan(0);
    });
  });
}
