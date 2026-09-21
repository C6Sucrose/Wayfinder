import { describe, it, expect } from "vitest";

export function runNotifierContract(make: () => import("../../src/adapters/types.js").Notifier): void {
  describe("Notifier contract", () => {
    it("never throws and returns a boolean delivered flag with a detail", async () => {
      const result = await make().notify({ event: "triaged", summary: "contract summary" });
      expect(typeof result.delivered).toBe("boolean");
      expect(typeof result.detail).toBe("string");
    });
  });
}

export function runCalendarContract(make: () => import("../../src/adapters/types.js").CalendarSink): void {
  describe("CalendarSink contract", () => {
    it("returns a non-empty ref", async () => {
      const { ref } = await make().publish({ title: "Contract", start: "2026-10-01T09:00:00.000Z" });
      expect(ref.length).toBeGreaterThan(0);
    });
  });
}

export function runPaymentContract(make: () => import("../../src/adapters/types.js").PaymentHandoff): void {
  describe("PaymentHandoff contract", () => {
    it("returns an instruction and a ledger note for a valid IBAN", () => {
      const result = make().prepare({
        amount: { currency: "EUR", value: 1 },
        beneficiaryName: "Contract",
        iban: "DE89370400440532013000",
        remittance: "R"
      });
      expect(result.instruction.length).toBeGreaterThan(0);
      expect(result.ledgerNote.length).toBeGreaterThan(0);
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
