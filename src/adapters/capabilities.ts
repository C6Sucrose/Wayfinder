import type { AdapterConfig } from "./config.js";
import { createLedger } from "../domain/ledgerLog.js";
import { verifyLedger } from "../domain/ledger.js";
import type { Store } from "../storage/types.js";

export interface ProviderSummary {
  brain: { provider: string; model?: string; protocol?: string };
  vision: { provider: string };
}

export type AlexaChannel = "skill" | "skill-dev" | "none";

export interface Capabilities {
  adapters: {
    notifier: "webhook" | "null";
    calendar: "ics" | "null";
    payment: "epc" | "null";
    signature: "local" | "kms" | "tsa";
    documentSource: "null";
    assist: "null";
  };
  chain: { head: string; verified: boolean };
  channels: { mcp: "http"; alexa: AlexaChannel };
  brain?: ProviderSummary["brain"];
  vision?: ProviderSummary["vision"];
}

export function buildCapabilities(config: AdapterConfig, chain: { head: string; verified: boolean }): Capabilities;
export function buildCapabilities(
  config: AdapterConfig,
  chain: { head: string; verified: boolean },
  providers: ProviderSummary
): Capabilities & { brain: ProviderSummary["brain"]; vision: ProviderSummary["vision"] };
export function buildCapabilities(
  config: AdapterConfig,
  chain: { head: string; verified: boolean },
  providers: ProviderSummary | undefined,
  channels?: { alexa: AlexaChannel }
): Capabilities;
export function buildCapabilities(
  config: AdapterConfig,
  chain: { head: string; verified: boolean },
  providers?: ProviderSummary,
  channels?: { alexa: AlexaChannel }
): Capabilities {
  return {
    adapters: {
      notifier: config.notifier.kind,
      calendar: config.calendar.kind,
      payment: config.payment.kind,
      signature: config.signature.kind,
      documentSource: config.documentSource.kind,
      assist: config.assist.kind
    },
    chain,
    channels: { mcp: "http", alexa: channels?.alexa ?? "none" },
    ...(providers !== undefined
      ? {
          brain: {
            provider: providers.brain.provider,
            ...(providers.brain.model !== undefined ? { model: providers.brain.model } : {}),
            ...(providers.brain.protocol !== undefined ? { protocol: providers.brain.protocol } : {})
          },
          vision: { provider: providers.vision.provider }
        }
      : {})
  };
}

export async function readChain(store: Store): Promise<{ head: string; verified: boolean }> {
  const entries = await createLedger(store).read();
  const result = verifyLedger(entries);
  return { head: entries[entries.length - 1]?.hash ?? "0".repeat(64), verified: result.ok };
}
