import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import { verifyAlexaRequest } from "../../src/alexa/verify.js";

const KEY = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PUBLIC_PEM = KEY.publicKey.export({ type: "spki", format: "pem" }).toString();

const body = Buffer.from(JSON.stringify({ version: "1.0", request: { timestamp: "2026-10-17T10:00:00Z" } }));
const url = "https://s3.amazonaws.com/echo.api/echo-api-cert.pem";

function signature(algorithm: "RSA-SHA1" | "RSA-SHA256" = "RSA-SHA256"): string {
  const signer = createSign(algorithm);
  signer.update(body);
  signer.end();
  return signer.sign(KEY.privateKey).toString("base64");
}

const fetchCert = async (): Promise<string> => PUBLIC_PEM;

const facts = { notBefore: "2026-01-01T00:00:00Z", notAfter: "2027-01-01T00:00:00Z", san: "echo-api.amazon.com" };

function input(overrides: Record<string, unknown> = {}) {
  return {
    rawBody: body,
    headers: { signature: signature(), certChainUrl: url },
    timestamp: "2026-10-17T10:00:00Z",
    now: new Date("2026-10-17T10:00:10Z"),
    fetchCert,
    certificate: facts,
    ...overrides
  };
}

describe("verifyAlexaRequest", () => {
  it("accepts a valid SHA-256 signature", async () => {
    expect(await verifyAlexaRequest(input())).toEqual({ ok: true });
  });

  it("accepts a valid SHA-1 signature", async () => {
    const r = await verifyAlexaRequest(input({ headers: { signature: signature("RSA-SHA1"), certChainUrl: url } }));
    expect(r).toEqual({ ok: true });
  });

  it("rejects a non-https certificate URL", async () => {
    const r = await verifyAlexaRequest(input({ headers: { signature: signature(), certChainUrl: "http://s3.amazonaws.com/echo.api/x.pem" } }));
    expect(r.ok).toBe(false);
  });

  it("rejects a certificate URL on a non-Amazon host", async () => {
    const r = await verifyAlexaRequest(input({ headers: { signature: signature(), certChainUrl: "https://evil.example/echo.api/x.pem" } }));
    expect(r.ok).toBe(false);
  });

  it("rejects a certificate URL outside /echo.api/", async () => {
    const r = await verifyAlexaRequest(input({ headers: { signature: signature(), certChainUrl: "https://s3.amazonaws.com/other/x.pem" } }));
    expect(r.ok).toBe(false);
  });

  it("rejects a non-default port", async () => {
    const r = await verifyAlexaRequest(input({ headers: { signature: signature(), certChainUrl: "https://s3.amazonaws.com:8443/echo.api/x.pem" } }));
    expect(r.ok).toBe(false);
  });

  it("rejects a body that does not match the signature", async () => {
    const r = await verifyAlexaRequest(input({ rawBody: Buffer.from("{}") }));
    expect(r.ok).toBe(false);
  });

  it("rejects a stale timestamp older than 150 seconds", async () => {
    const r = await verifyAlexaRequest(input({ now: new Date("2026-10-17T10:03:00Z") }));
    expect(r.ok).toBe(false);
  });

  it("rejects a timestamp too far in the future", async () => {
    const r = await verifyAlexaRequest(input({ now: new Date("2026-10-17T09:55:00Z") }));
    expect(r.ok).toBe(false);
  });

  it("rejects an unparseable timestamp", async () => {
    const r = await verifyAlexaRequest(input({ timestamp: "not-a-date" }));
    expect(r.ok).toBe(false);
  });

  it("rejects a missing signature", async () => {
    const r = await verifyAlexaRequest(input({ headers: { certChainUrl: url } }));
    expect(r.ok).toBe(false);
  });

  it("rejects a missing certificate URL", async () => {
    const r = await verifyAlexaRequest(input({ headers: { signature: signature() } }));
    expect(r.ok).toBe(false);
  });

  it("rejects a certificate that is not yet valid", async () => {
    const r = await verifyAlexaRequest(input({ certificate: { notBefore: "2027-01-01T00:00:00Z", notAfter: "2028-01-01T00:00:00Z", san: "echo-api.amazon.com" } }));
    expect(r.ok).toBe(false);
  });

  it("rejects an expired certificate", async () => {
    const r = await verifyAlexaRequest(input({ certificate: { notBefore: "2025-01-01T00:00:00Z", notAfter: "2025-12-31T00:00:00Z", san: "echo-api.amazon.com" } }));
    expect(r.ok).toBe(false);
  });

  it("rejects a certificate without the required SAN", async () => {
    const r = await verifyAlexaRequest(input({ certificate: { notBefore: "2026-01-01T00:00:00Z", notAfter: "2027-01-01T00:00:00Z", san: "example.com" } }));
    expect(r.ok).toBe(false);
  });

  it("accepts a SAN list containing the required name", async () => {
    const r = await verifyAlexaRequest(input({ certificate: { notBefore: "2026-01-01T00:00:00Z", notAfter: "2027-01-01T00:00:00Z", san: "DNS:example.com, DNS:echo-api.amazon.com" } }));
    expect(r.ok).toBe(true);
  });

  it("rejects when the certificate cannot be fetched", async () => {
    const r = await verifyAlexaRequest(input({ fetchCert: async () => { throw new Error("timeout"); } }));
    expect(r.ok).toBe(false);
  });

  it("rejects when no facts are injected and the PEM is not a certificate", async () => {
    const r = await verifyAlexaRequest({
      rawBody: body,
      headers: { signature: signature(), certChainUrl: url },
      timestamp: "2026-10-17T10:00:00Z",
      now: new Date("2026-10-17T10:00:10Z"),
      fetchCert
    });
    expect(r.ok).toBe(false);
  });
});
