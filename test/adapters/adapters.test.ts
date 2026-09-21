import { describe, it, expect } from "vitest";
import { nullAdapters } from "../../src/adapters/null.js";
import { resolveAdapterConfig } from "../../src/adapters/config.js";
import { buildEpcPayload, crc16ccitt, epcPayment } from "../../src/adapters/epcQr.js";

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

describe("resolveAdapterConfig", () => {
  it("returns all-null when nothing is configured", () => {
    const config = resolveAdapterConfig({});
    expect(config.notifier).toEqual({ kind: "null" });
    expect(config.calendar).toEqual({ kind: "null" });
    expect(config.payment).toEqual({ kind: "null" });
    expect(config.warnings).toEqual([]);
  });

  it("enables the webhook notifier only when the URL is https and allowlisted", () => {
    const good = resolveAdapterConfig({
      WAYFINDER_ADAPTER_NOTIFIER: "webhook",
      WAYFINDER_WEBHOOK_URL: "https://hooks.example/wf",
      WAYFINDER_WEBHOOK_ALLOWLIST: "https://hooks.example/wf"
    });
    expect(good.notifier).toEqual({ kind: "webhook", url: "https://hooks.example/wf", allowlist: ["https://hooks.example/wf"], timeoutMs: 5000 });
    const bad = resolveAdapterConfig({
      WAYFINDER_ADAPTER_NOTIFIER: "webhook",
      WAYFINDER_WEBHOOK_URL: "http://hooks.example/wf",
      WAYFINDER_WEBHOOK_ALLOWLIST: "http://hooks.example/wf"
    });
    expect(bad.notifier).toEqual({ kind: "null" });
    expect(bad.warnings.join(" ")).toMatch(/https/i);
  });

  it("refuses a webhook URL that is not exactly allowlisted", () => {
    const config = resolveAdapterConfig({
      WAYFINDER_ADAPTER_NOTIFIER: "webhook",
      WAYFINDER_WEBHOOK_URL: "https://hooks.example/wf",
      WAYFINDER_WEBHOOK_ALLOWLIST: "https://hooks.example/other"
    });
    expect(config.notifier).toEqual({ kind: "null" });
    expect(config.warnings.join(" ")).toMatch(/allowlist/i);
  });

  it("enables adapters from preferences through the same rules", () => {
    const config = resolveAdapterConfig({ WAYFINDER_ICS_DIR: "/tmp/ics" }, { calendar: "ics", payment: "epc" });
    expect(config.calendar).toEqual({ kind: "ics", dir: "/tmp/ics" });
    expect(config.payment).toEqual({ kind: "epc" });
  });

  it("requires a directory for the ICS sink", () => {
    const config = resolveAdapterConfig({}, { calendar: "ics" });
    expect(config.calendar).toEqual({ kind: "null" });
    expect(config.warnings.join(" ")).toMatch(/WAYFINDER_ICS_DIR/);
  });

  it("falls back to the default timeout and warns when the configured timeout is invalid", () => {
    const bad = resolveAdapterConfig({
      WAYFINDER_ADAPTER_NOTIFIER: "webhook",
      WAYFINDER_WEBHOOK_URL: "https://hooks.example/wf",
      WAYFINDER_WEBHOOK_ALLOWLIST: "https://hooks.example/wf",
      WAYFINDER_ADAPTER_TIMEOUT_MS: "abc"
    });
    expect(bad.notifier).toEqual({ kind: "webhook", url: "https://hooks.example/wf", allowlist: ["https://hooks.example/wf"], timeoutMs: 5000 });
    expect(bad.warnings.join(" ")).toMatch(/WAYFINDER_ADAPTER_TIMEOUT_MS/);

    const good = resolveAdapterConfig({
      WAYFINDER_ADAPTER_NOTIFIER: "webhook",
      WAYFINDER_WEBHOOK_URL: "https://hooks.example/wf",
      WAYFINDER_WEBHOOK_ALLOWLIST: "https://hooks.example/wf",
      WAYFINDER_ADAPTER_TIMEOUT_MS: "2500"
    });
    expect(good.notifier).toEqual({ kind: "webhook", url: "https://hooks.example/wf", allowlist: ["https://hooks.example/wf"], timeoutMs: 2500 });
  });
});

function independentCrc16(input: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(input, "utf8")) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

describe("epcQr", () => {
  it("builds an EPC069-12 payload whose trailing checksum round-trips", () => {
    const payload = buildEpcPayload({
      beneficiaryName: "City Water",
      iban: "DE89370400440532013000",
      amount: { currency: "EUR", value: 12.5 },
      remittance: "INV-1"
    });
    const data = payload.slice(0, -4);
    const checksum = payload.slice(-4);
    expect(checksum).toBe(independentCrc16(data));
    expect(data.startsWith("BCD\n002\n1\nSCT\n")).toBe(true);
    expect(data).toContain("City Water");
    expect(data).toContain("DE89370400440532013000");
    expect(data).toContain("EUR12.50");
    expect(data.endsWith("\n")).toBe(true);
  });

  it("refuses an invalid IBAN", () => {
    expect(() => buildEpcPayload({
      beneficiaryName: "City Water",
      iban: "DE89370400440532013001",
      amount: { currency: "EUR", value: 12.5 },
      remittance: "INV-1"
    })).toThrow(/invalid IBAN/i);
  });

  it("epcPayment prepares a payload and refuses an invalid IBAN", () => {
    const result = epcPayment.prepare({
      amount: { currency: "EUR", value: 12.5 },
      beneficiaryName: "City Water",
      iban: "DE89370400440532013000",
      remittance: "INV-1"
    });
    expect(result.epcQr).toBeDefined();
    expect(() => epcPayment.prepare({
      amount: { currency: "EUR", value: 12.5 },
      beneficiaryName: "City Water",
      iban: "DE89370400440532013001",
      remittance: "INV-1"
    })).toThrow(/invalid IBAN/i);
  });

  it("crc16ccitt matches a known vector", () => {
    expect(crc16ccitt("123456789")).toBe("29B1");
  });
});
