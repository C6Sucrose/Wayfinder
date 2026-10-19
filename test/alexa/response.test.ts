import { describe, it, expect } from "vitest";
import { buildAlexaResponse } from "../../src/alexa/response.js";

const base = { speech: "Hello", end: true };

describe("buildAlexaResponse", () => {
  it("wraps speech in SSML", () => {
    const r = buildAlexaResponse(base, { aplSupported: false });
    expect(r.response.outputSpeech).toEqual({ type: "SSML", ssml: "<speak>Hello</speak>" });
    expect(r.version).toBe("1.0");
  });

  it("escapes hostile speech values", () => {
    const r = buildAlexaResponse({ speech: `<b>&"x"</b>'`, end: true }, { aplSupported: false });
    expect(r.response.outputSpeech.ssml).toContain("&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;&#39;");
    expect(r.response.outputSpeech.ssml).not.toContain("<b>");
  });

  it("sets shouldEndSession", () => {
    expect(buildAlexaResponse({ speech: "x", end: true }, { aplSupported: false }).response.shouldEndSession).toBe(true);
    expect(buildAlexaResponse({ speech: "x", end: false }, { aplSupported: false }).response.shouldEndSession).toBe(false);
  });

  it("adds a simple card when a title is present", () => {
    const r = buildAlexaResponse({ ...base, title: "Backlog", body: "City Water" }, { aplSupported: false });
    expect(r.response.card).toEqual({ type: "Simple", title: "Backlog", content: "City Water" });
  });

  it("omits the card without a title", () => {
    expect(buildAlexaResponse(base, { aplSupported: false }).response.card).toBeUndefined();
  });

  it("adds the APL directive only when supported", () => {
    const withApl = buildAlexaResponse({ ...base, title: "Backlog", body: "City Water" }, { aplSupported: true });
    expect(withApl.response.directives).toHaveLength(1);
    expect(withApl.response.directives?.[0]?.type).toBe("Alexa.Presentation.APL.RenderDocument");
    expect(withApl.response.directives?.[0]?.document.version).toBe("1.6");
    expect(withApl.response.directives?.[0]?.datasources.payload.title).toBe("Backlog");
    expect(buildAlexaResponse({ ...base, title: "Backlog" }, { aplSupported: false }).response.directives).toBeUndefined();
  });

  it("adds a reprompt when the session continues", () => {
    const r = buildAlexaResponse({ speech: "x", end: false, reprompt: "Try again" }, { aplSupported: false });
    expect(r.response.reprompt?.outputSpeech.ssml).toContain("Try again");
  });
});
