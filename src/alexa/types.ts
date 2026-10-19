export interface AlexaHeaders {
  signature?: string;
  certChainUrl?: string;
}

export interface CertificateFacts {
  notBefore: string;
  notAfter: string;
  san: string;
}

export interface VerifyInput {
  rawBody: Uint8Array;
  headers: AlexaHeaders;
  timestamp: string;
  now?: Date;
  fetchCert?: (url: string) => Promise<string>;
  certificate?: CertificateFacts;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };
