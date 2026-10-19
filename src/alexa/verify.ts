import { createVerify, X509Certificate } from "node:crypto";
import type { CertificateFacts, VerifyInput, VerifyResult } from "./types.js";

export const CERT_HOST = "s3.amazonaws.com";
export const CERT_PATH_PREFIX = "/echo.api/";
export const CERT_SAN = "echo-api.amazon.com";
export const MAX_CLOCK_SKEW_SECONDS = 150;
const CERT_TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_LIMIT = 8;

const cache = new Map<string, { pem: string; fetchedAt: number }>();

export function timestampFresh(timestamp: string, now: Date = new Date()): boolean {
  const requested = Date.parse(timestamp);
  if (!Number.isFinite(requested)) return false;
  return Math.abs(now.getTime() - requested) <= MAX_CLOCK_SKEW_SECONDS * 1000;
}

function cacheKey(url: string): string {
  const parsed = new URL(url);
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function validCertUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.port !== "" && url.port !== "443") return false;
  if (url.hostname !== CERT_HOST) return false;
  return url.pathname.startsWith(CERT_PATH_PREFIX);
}

async function fetchPem(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CERT_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "error" });
    if (!response.ok) throw new Error(`cert ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function loadCert(url: string, fetchCert?: (url: string) => Promise<string>): Promise<string | undefined> {
  if (fetchCert) {
    try {
      return await fetchCert(url);
    } catch {
      return undefined;
    }
  }
  const cached = cache.get(cacheKey(url));
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.pem;
  try {
    const pem = await fetchPem(url);
    const key = cacheKey(url);
    if (!cache.has(key) && cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, { pem, fetchedAt: Date.now() });
    return pem;
  } catch {
    return undefined;
  }
}

function factsFromPem(pem: string): CertificateFacts | undefined {
  try {
    const cert = new X509Certificate(pem);
    return { notBefore: cert.validFrom, notAfter: cert.validTo, san: cert.subjectAltName ?? "" };
  } catch {
    return undefined;
  }
}

function sanMatches(san: string): boolean {
  return san
    .split(",")
    .map((entry) => entry.trim().replace(/^DNS:/i, ""))
    .some((entry) => entry === CERT_SAN);
}

function factsValid(facts: CertificateFacts, now: Date): boolean {
  const notBefore = Date.parse(facts.notBefore);
  const notAfter = Date.parse(facts.notAfter);
  if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter)) return false;
  const at = now.getTime();
  if (at < notBefore || at > notAfter) return false;
  return sanMatches(facts.san);
}

function signatureValid(pem: string, rawBody: Uint8Array, signatureB64: string): boolean {
  const sig = Buffer.from(signatureB64, "base64");
  if (sig.byteLength === 0) return false;
  for (const algorithm of ["RSA-SHA256", "RSA-SHA1"] as const) {
    try {
      const verifier = createVerify(algorithm);
      verifier.update(rawBody);
      verifier.end();
      if (verifier.verify(pem, sig)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export async function verifyAlexaRequest(input: VerifyInput): Promise<VerifyResult> {
  const { headers, rawBody, timestamp } = input;
  const now = input.now ?? new Date();

  if (!headers.certChainUrl) return { ok: false, reason: "missing certificate url" };
  if (!validCertUrl(headers.certChainUrl)) return { ok: false, reason: "invalid certificate url" };
  if (!headers.signature) return { ok: false, reason: "missing signature" };

  const pem = await loadCert(headers.certChainUrl, input.fetchCert);
  if (!pem) return { ok: false, reason: "certificate unavailable" };

  const facts = input.certificate ?? factsFromPem(pem);
  if (!facts) return { ok: false, reason: "certificate unreadable" };
  if (!factsValid(facts, now)) return { ok: false, reason: "certificate invalid" };

  if (!signatureValid(pem, rawBody, headers.signature)) return { ok: false, reason: "signature mismatch" };

  if (!timestampFresh(timestamp, now)) return { ok: false, reason: "stale timestamp" };

  return { ok: true };
}
