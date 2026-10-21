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
      // SVG served as XML: only the five predefined entities, plus numeric refs.
      expect(svg, file).not.toMatch(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/);
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
    for (const file of [
      "docs/demo-script.md",
      "docs/video/production-plan.md",
      "docs/video/scenes.json",
      "docs/video/narration.md",
      "docs/video/youtube-upload.md"
    ]) {
      expect(existsSync(file), file).toBe(false);
    }
    expect(read(".gitignore")).toContain(".private/");
  });

  it("ships the submission artifacts", () => {
    for (const file of [
      "docs/submission.md",
      "docs/friction-log.md",
      "docs/feedback/README.md",
      "docs/feedback/aws.md",
      "docs/feedback/mcp-sdk.md",
      "docs/feedback/mcp-apps.md",
      "docs/feedback/web-platform.md",
      "docs/feedback/tooling.md"
    ]) {
      expect(existsSync(file), file).toBe(true);
    }
    const submission = read("docs/submission.md");
    expect(submission).toContain("Alexa+");
    expect(submission).toContain("AWS Builder");
    expect(submission).toContain("Open Source");
    expect(submission).toContain("(feedback/README.md)");
    expect(submission).toContain("(friction-log.md)");
  });

  it("states the honest limitations in the submission", () => {
    const submission = read("docs/submission.md").toLowerCase();
    for (const claim of ["not legal evidence", "recorded confirmation", "not implemented"]) {
      expect(submission, claim).toContain(claim);
    }
    expect(submission).not.toContain("bank-verified");
  });

  it("ships the Alexa skill artifacts", () => {
    for (const file of [
      "docs/alexa/skill.json",
      "docs/alexa/interaction-model.json",
      "docs/alexa/README.md",
      "docs/alexa/sample-request.json"
    ]) {
      expect(existsSync(file), file).toBe(true);
    }
    const manifest = JSON.parse(readFileSync("docs/alexa/skill.json", "utf8"));
    expect(manifest.apis.custom.endpoint.uri).toContain("/alexa");
    const model = JSON.parse(readFileSync("docs/alexa/interaction-model.json", "utf8"));
    const intents = model.interactionModel.languageModel.intents as Array<{
      name: string;
      slots?: Array<{ name: string; type: string }>;
    }>;
    const names = intents.map((i) => i.name);
    for (const intent of [
      "AMAZON.HelpIntent",
      "AMAZON.StopIntent",
      "AMAZON.CancelIntent",
      "AMAZON.FallbackIntent",
      "ReadMailIntent",
      "BacklogIntent",
      "DueTodayIntent",
      "ProveIntent",
      "WhereIsIntent",
      "RememberIntent"
    ]) {
      expect(names).toContain(intent);
    }
    const slots = intents.flatMap((i) => i.slots ?? []);
    expect(slots.map((s) => s.name)).toContain("item");
    expect(slots.map((s) => s.name)).toContain("location");
    expect(slots.map((s) => s.type)).toContain("ITEM");
    expect(slots.map((s) => s.type)).toContain("LOCATION");
    const readme = readFileSync("docs/alexa/README.md", "utf8");
    expect(readme).toContain("WAYFINDER_ALEXA_VERIFY");
    expect(readme.toLowerCase()).toContain("could not test against");
  });

  it("leaks no account identifiers into the public docs", () => {
    const haystack = [
      read("README.md"),
      read("docs/index.html"),
      read("docs/submission.md"),
      read("docs/friction-log.md"),
      read("docs/feedback/README.md"),
      read("docs/feedback/aws.md"),
      read("docs/feedback/mcp-sdk.md"),
      read("docs/feedback/mcp-apps.md"),
      read("docs/feedback/web-platform.md"),
      read("docs/feedback/tooling.md"),
      read("docs/diagrams/architecture.svg"),
      read("docs/diagrams/authority.svg"),
      read("docs/alexa/skill.json"),
      read("docs/alexa/interaction-model.json"),
      read("docs/alexa/README.md"),
      read("docs/alexa/sample-request.json")
    ].join("\n");
    for (const secret of ["958452485624", "L-F4DDD3EB", "L-58BE175A", "arn:aws:", "178993905600770"]) {
      expect(haystack, secret).not.toContain(secret);
    }
  });
});
