#!/usr/bin/env node
/**
 * Verify Amazon Bedrock is ready for Wayfinder (text brain + multimodal reader).
 *
 * Usage:
 *   PowerShell:
 *     $env:BEDROCK_MODEL_ID="us.anthropic.claude-..."; $env:AWS_REGION="us-east-1"
 *     node scripts/verify-bedrock.mjs
 *   bash / zsh:
 *     export BEDROCK_MODEL_ID="us.anthropic.claude-..."; export AWS_REGION="us-east-1"
 *     node scripts/verify-bedrock.mjs
 *
 * Requires AWS credentials in the default chain (env vars or ~/.aws/credentials).
 */
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

const region = process.env.AWS_REGION ?? "us-east-1";
const modelId = process.env.BEDROCK_MODEL_ID;
const client = new BedrockRuntimeClient({ region });

function describe(err) {
  const name = err?.name ?? "Error";
  const message = err?.message ?? String(err);
  const hints = {
    CredentialsProviderError: "no AWS credentials found — set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, or configure a profile",
    UnrecognizedClientException: "credentials are missing or invalid (set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, or configure a profile)",
    InvalidSignatureException: "credentials look invalid — check the access key and secret",
    ExpiredTokenException: "session token expired — refresh credentials",
    AccessDeniedException: "model access is not enabled for this account/model, or IAM lacks bedrock:InvokeModel",
    ResourceNotFoundException: "model id is not available in this region, or the Anthropic use-case form has not been submitted",
    ValidationException: "model id is unsupported, or the request shape is wrong",
    ThrottlingException: "rate limited — retry shortly"
  };
  return `${name}: ${message}\n  hint: ${hints[name] ?? "unexpected error"}`;
}

const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64"
  )
);

async function textProbe() {
  const res = await client.send(
    new ConverseCommand({
      modelId,
      messages: [{ role: "user", content: [{ text: "Reply with the single word: ok" }] }],
      inferenceConfig: { maxTokens: 16 }
    })
  );
  return (res.output?.message?.content ?? []).map((b) => b.text).filter(Boolean).join(" ").trim();
}

async function visionProbe() {
  const res = await client.send(
    new ConverseCommand({
      modelId,
      messages: [
        {
          role: "user",
          content: [
            { image: { format: "png", source: { bytes: PNG } } },
            { text: "What is the dominant colour of this image? Answer with one word." }
          ]
        }
      ],
      inferenceConfig: { maxTokens: 16 }
    })
  );
  return (res.output?.message?.content ?? []).map((b) => b.text).filter(Boolean).join(" ").trim();
}

if (!modelId) {
  console.error("BEDROCK_MODEL_ID is not set.");
  console.error("Pick a Claude inference profile, e.g. us.anthropic.claude-sonnet-4-5-20250929-v1:0");
  console.error(`List options with: aws bedrock list-inference-profiles --region ${region}`);
  process.exit(2);
}

console.log(`region  = ${region}`);
console.log(`modelId = ${modelId}`);

try {
  console.log(`text   -> ${await textProbe()}`);
} catch (err) {
  console.error(`\ntext probe FAILED\n  ${describe(err)}`);
  process.exit(1);
}

try {
  console.log(`vision -> ${await visionProbe()}`);
} catch (err) {
  console.error(`\nvision probe FAILED\n  ${describe(err)}`);
  process.exit(1);
}

console.log("\nBedrock is ready: text and multimodal both work.");
console.log("Start the server with:");
console.log(`  PowerShell: $env:BEDROCK_MODEL_ID="${modelId}"; $env:AWS_REGION="${region}"; npm start`);
console.log(`  bash/zsh:   BEDROCK_MODEL_ID="${modelId}" AWS_REGION="${region}" npm start`);
