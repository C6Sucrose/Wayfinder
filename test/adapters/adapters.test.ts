import { describe, it, expect } from "vitest";
import { nullAdapters } from "../../src/adapters/null.js";

describe("null adapters", () => {
  it("delivers nothing and says so without throwing", async () => {
    await expect(nullAdapters.notifier.notify({ event: "triaged", summary: "x" })).resolves.toEqual({
      delivered: false,
      detail: "no notifier configured"
    });
  });

  it("returns an internal ref for calendar publishes without touching the filesystem", async () => {
    await expect(nullAdapters.calendar.publish({ title: "Dentist", start: "2026-10-01T09:00:00.000Z" })).resolves.toEqual({
      ref: "ledger:Dentist"
    });
  });

  it("prepares a spoken-only payment with no QR payload", () => {
    const result = nullAdapters.payment.prepare({
      amount: { currency: "EUR", value: 12.5 },
      beneficiaryName: "City Water",
      iban: "DE89370400440532013000",
      remittance: "INV-1"
    });
    expect(result.instruction).toContain("City Water");
    expect(result.epcQr).toBeUndefined();
    expect(result.ledgerNote).toContain("no payment was made");
  });

  it("attests locally with the head hash", async () => {
    await expect(nullAdapters.signature.attest("a".repeat(64))).resolves.toEqual({ kind: "local", proof: "a".repeat(64) });
  });

  it("polls to nothing and keeps the cursor stable", async () => {
    await expect(nullAdapters.documentSource.poll(undefined)).resolves.toEqual({ imageRefs: [], texts: [], cursor: "0" });
  });

  it("returns a null assist session", async () => {
    await expect(nullAdapters.assist.request({ reason: "unclear", documentId: "itm_a" })).resolves.toEqual({ sessionRef: "none" });
  });
});
