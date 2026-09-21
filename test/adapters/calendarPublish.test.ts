import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFileStore } from "../../src/storage/fileStore.js";
import { buildServer } from "../../src/mcp/server.js";
import { createAdapters } from "../../src/adapters/registry.js";
import { resolveAdapterConfig } from "../../src/adapters/config.js";
import { settleAdapterTasks } from "../../src/adapters/background.js";

describe("calendar publish wiring", () => {
  it("writes an ICS file and records external_invoked for a scheduled appointment", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-cal-publish-"));
    const store = createFileStore(mkdtempSync(join(tmpdir(), "wf-")));
    const adapterConfig = resolveAdapterConfig({ WAYFINDER_ADAPTER_CALENDAR: "ics", WAYFINDER_ICS_DIR: dir });
    const server = buildServer({ store, adapterConfig, adapters: createAdapters(adapterConfig) });
    const client = new Client({ name: "t", version: "0.0.1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);

    await store.putItem({
      itemId: "itm_sched",
      scanId: "scn_sched",
      class: "appointment",
      confidence: 0.9,
      readAloudText: "Appointment at City Clinic on 1 November.",
      fields: { sender: "City Clinic", appointmentAt: "2026-11-01T09:00:00.000Z" },
      proposedActions: [{
        actionId: "itm_sched:schedule",
        itemId: "itm_sched",
        type: "schedule",
        params: { at: "2026-11-01T09:00:00.000Z" },
        status: "proposed"
      }],
      createdAt: "2026-09-20T10:00:00.000Z",
      resolvedAt: null
    });

    const res = await client.callTool({
      name: "act_on_item",
      arguments: { itemId: "itm_sched", actionId: "itm_sched:schedule", confirmed: true }
    });
    expect(res.isError).not.toBe(true);
    await settleAdapterTasks();

    const files = readdirSync(dir).filter((f) => f.endsWith(".ics"));
    expect(files).toHaveLength(1);
    expect(readFileSync(join(dir, files[0]!), "utf8")).toContain("SUMMARY:City Clinic");

    const entry = (await store.listLedger()).find(
      (e) => e.event === "external_invoked" && e.details.adapter === "calendar"
    );
    expect(entry).toBeDefined();

    await client.close();
  });
});
