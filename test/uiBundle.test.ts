import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const OUT = "dist/ui/app.html";

describe("ui bundle", () => {
  beforeAll(() => {
    execFileSync(process.execPath, ["ui/build.mjs"], { stdio: "pipe" });
  });

  it("builds a single self-contained HTML file", () => {
    expect(existsSync(OUT)).toBe(true);
    const html = readFileSync(OUT, "utf8");
    expect(html).toMatch(/<!doctype html>/i);
    expect(html.length).toBeGreaterThan(500);
    // self-contained: no external script/style/stylesheet origins
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet["']/i);
  });
});
