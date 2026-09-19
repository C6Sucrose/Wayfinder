import { describe, it, expect } from "vitest";
import { parseLabel } from "../src/domain/labelParser.js";
import { copy } from "../src/domain/copy.js";

describe("parseLabel", () => {
  it("keeps label text verbatim and attaches the disclaimer", () => {
    const parsed = parseLabel("Ibuprofen 400mg\nBest before 2027-03\nContains lactose");
    expect(parsed.labelText).toContain("Ibuprofen 400mg");
    expect(parsed.name).toBe("Ibuprofen 400mg");
    expect(parsed.details.join(" ")).toMatch(/Best before/);
    expect(parsed.disclaimer).toBe(copy.disclaimers.label);
  });
  it("never invents medical advice", () => {
    const parsed = parseLabel("Some product\nIngredients: water, salt");
    expect(parsed.labelText).toBe("Some product\nIngredients: water, salt");
    expect(parsed.disclaimer).toMatch(/not medical advice/i);
  });
});
