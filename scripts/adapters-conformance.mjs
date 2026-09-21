#!/usr/bin/env node
/**
 * Run the adapter conformance suite and validate the configured adapters.
 * Exits non-zero when a configured adapter fails its contract or is misconfigured.
 *
 * Configured adapters (WAYFINDER_ADAPTER_*) are validated for wiring and offline contracts only;
 * network delivery is intentionally not attempted here.
 *
 * Usage:
 *   npm run adapters:conformance
 */
import { spawnSync } from "node:child_process";

const result = spawnSync(
  "npx",
  ["vitest", "run", "test/adapters/contract.test.ts", "test/adapters/configured.test.ts"],
  {
    stdio: "inherit",
    shell: process.platform === "win32"
  }
);
if (result.status !== 0) {
  console.error("\nAdapter conformance FAILED.");
  process.exit(result.status ?? 1);
}
console.log("\nAdapter conformance passed. Configure adapters with WAYFINDER_ADAPTER_<PORT>.");
