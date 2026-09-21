import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAdapterConfig } from "../../src/adapters/config.js";
import type { AdapterConfig } from "../../src/adapters/config.js";
import { createAdapters } from "../../src/adapters/registry.js";
import { nullAdapters } from "../../src/adapters/null.js";

/**
 * Assert that createAdapters honors the resolved config: every port the config
 * claims configured is wired to a non-null adapter, and every other port stays null.
 * A configured port that silently falls back to null fails here.
 */
function expectConfiguredWiring(config: AdapterConfig): void {
  const adapters = createAdapters(config);

  expect(adapters.signature).toBe(nullAdapters.signature);
  expect(adapters.documentSource).toBe(nullAdapters.documentSource);
  expect(adapters.assist).toBe(nullAdapters.assist);

  if (config.notifier.kind === "webhook") expect(adapters.notifier).not.toBe(nullAdapters.notifier);
  else expect(adapters.notifier).toBe(nullAdapters.notifier);

  if (config.calendar.kind === "ics") expect(adapters.calendar).not.toBe(nullAdapters.calendar);
  else expect(adapters.calendar).toBe(nullAdapters.calendar);

  if (config.payment.kind === "epc") expect(adapters.payment).not.toBe(nullAdapters.payment);
  else expect(adapters.payment).toBe(nullAdapters.payment);
}

describe("configured adapter conformance", () => {
  it("wires a configured webhook notifier to the reference adapter", () => {
    const config = resolveAdapterConfig({
      WAYFINDER_ADAPTER_NOTIFIER: "webhook",
      WAYFINDER_WEBHOOK_URL: "https://hooks.example/wf",
      WAYFINDER_WEBHOOK_ALLOWLIST: "https://hooks.example/wf"
    });
    expect(config.notifier.kind).toBe("webhook");
    expectConfiguredWiring(config);
  });

  it("wires a configured ICS sink to the reference adapter", () => {
    const config = resolveAdapterConfig({
      WAYFINDER_ADAPTER_CALENDAR: "ics",
      WAYFINDER_ICS_DIR: mkdtempSync(join(tmpdir(), "wf-configured-"))
    });
    expect(config.calendar.kind).toBe("ics");
    expectConfiguredWiring(config);
  });

  it("wires a configured EPC handoff to the reference adapter", () => {
    const config = resolveAdapterConfig({ WAYFINDER_ADAPTER_PAYMENT: "epc" });
    expect(config.payment.kind).toBe("epc");
    expectConfiguredWiring(config);
  });

  it("resolves every unconfigured port to its null adapter", () => {
    expectConfiguredWiring(resolveAdapterConfig({}));
  });

  it("wires every port the ambient environment configures, with no silent null fallback", () => {
    const env = process.env;
    if (env.WAYFINDER_ADAPTER_NOTIFIER === "webhook") {
      expect(resolveAdapterConfig(env).notifier.kind).toBe("webhook");
    }
    if (env.WAYFINDER_ADAPTER_CALENDAR === "ics") {
      expect(resolveAdapterConfig(env).calendar.kind).toBe("ics");
    }
    if (env.WAYFINDER_ADAPTER_PAYMENT === "epc") {
      expect(resolveAdapterConfig(env).payment.kind).toBe("epc");
    }
    expectConfiguredWiring(resolveAdapterConfig(env));
  });
});
