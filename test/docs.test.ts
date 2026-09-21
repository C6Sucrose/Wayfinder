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
    expect(md).toContain("docs/diagrams/architecture.svg");
    expect(md).toContain("docs/diagrams/authority.svg");
    // Diagrams are hand-authored SVG so no renderer can clip a label.
    expect(md).not.toContain("```mermaid");
  });

  it("ships accessible SVG diagrams", () => {
    for (const file of ["docs/diagrams/architecture.svg", "docs/diagrams/authority.svg"]) {
      const svg = read(file);
      expect(svg, file).toMatch(/^<svg[\s>]/);
      expect(svg, file).toContain('role="img"');
      expect(svg, file).toContain("<title");
      expect(svg, file).toContain('viewBox="');
      expect(svg, file).not.toMatch(/<script/i);
    }
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
    const haystack = [
      read("README.md"),
      read("docs/index.html"),
      read("docs/demo-script.md"),
      read("docs/diagrams/architecture.svg"),
      read("docs/diagrams/authority.svg")
    ].join("\n");
    for (const secret of ["958452485624", "L-F4DDD3EB", "L-58BE175A", "arn:aws:"]) {
      expect(haystack, secret).not.toContain(secret);
    }
  });
});
