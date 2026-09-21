import { ibanIsValid } from "../domain/validity.js";
import type { PaymentHandoff } from "./types.js";

export function crc16ccitt(input: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(input, "utf8")) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function buildEpcPayload(input: {
  beneficiaryName: string;
  iban: string;
  amount: { currency: string; value: number };
  remittance: string;
  bic?: string;
  purpose?: string;
}): string {
  if (!ibanIsValid(input.iban)) {
    throw new Error("Refusing to build an EPC payload for an invalid IBAN.");
  }
  const iban = input.iban.replace(/\s+/g, "").toUpperCase();
  const amount = `${input.amount.currency}${input.amount.value.toFixed(2)}`;
  const lines = [
    "BCD",
    "002",
    "1",
    "SCT",
    input.bic ?? "",
    input.beneficiaryName.slice(0, 70),
    iban,
    amount,
    input.purpose ?? "",
    input.remittance.slice(0, 140)
  ];
  const data = `${lines.join("\n")}\n`;
  return `${data}${crc16ccitt(data)}`;
}

export const epcPayment: PaymentHandoff = {
  prepare(input) {
    if (!ibanIsValid(input.iban)) {
      throw new Error("Refusing to prepare a payment handoff for an invalid IBAN.");
    }
    const epcQr = buildEpcPayload({
      beneficiaryName: input.beneficiaryName,
      iban: input.iban,
      amount: input.amount,
      remittance: input.remittance
    });
    const money = `${input.amount.currency} ${input.amount.value.toFixed(2)}`;
    return {
      instruction: `To pay ${money} to ${input.beneficiaryName}, open your banking app and scan the handoff code. I have not moved any money.`,
      epcQr,
      ledgerNote: `Payment handoff prepared for ${input.beneficiaryName} in ${input.amount.currency}; no payment was executed.`
    };
  }
};
