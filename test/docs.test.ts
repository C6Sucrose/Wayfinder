import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const read = (p: string): string => readFileSync(p, "utf8");

describe("public documentation", () => {
  it("ships a README with the expected sections", () => {
    const md = read("README.md");
    for (const heading of [
      "# Wayfinder",
      "## Why",
      "## What it does",
      "## Quick start",
      "## Accessibility",
      "## Safety and privacy",
      "## Optional integrations",
      "## License"
    ]) {
      expect(md, heading).toContain(heading);
    }
    expect(md).toContain("docs/index.html");
    expect(md).toContain("```mermaid");
  });

  it("ships a self-contained interactive page", () => {
    const html = read("docs/index.html");
    expect(html).toMatch(/<!doctype html>/i);
    expect(html.length).toBeGreaterThan(5000);
    expect(html).toMatch(/<style>/);
    expect(html).toMatch(/<script>/);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet["']/i);
    expect(html).not.toMatch(/@import\s+url/i);
  });

  it("keeps internal design and development docs out of the repository", () => {
    expect(existsSync("docs/superpowers")).toBe(false);
  });

  it("leaks no account identifiers into the public docs", () => {
    const haystack = [read("README.md"), read("docs/index.html"), read("docs/demo-script.md")].join("\n");
    for (const secret of ["958452485624", "L-F4DDD3EB", "L-58BE175A", "arn:aws:"]) {
      expect(haystack, secret).not.toContain(secret);
    }
  });
});
