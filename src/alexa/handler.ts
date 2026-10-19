import type { AgentService } from "../agent/service.js";
import { routeIntent, type AlexaIntentRequest } from "./intents.js";
import { buildAlexaResponse } from "./response.js";
import type { SessionStore } from "./sessions.js";
import type { VerifyInput, VerifyResult } from "./types.js";

export interface AlexaDeps {
  verify: (input: VerifyInput) => Promise<VerifyResult>;
  agent: AgentService;
  sessions: SessionStore;
  verifyEnabled: boolean;
}

export interface AlexaHttpResult {
  status: number;
  body: unknown;
}

const APOLOGY = "Sorry, I couldn't do that. Please try again.";

export function createAlexaHandler(deps: AlexaDeps) {
  return async (rawBody: Uint8Array, headers: VerifyInput["headers"] = {}): Promise<AlexaHttpResult> => {
    let parsed: AlexaIntentRequest & { version?: string; session?: { sessionId?: string }; context?: { System?: { device?: { supportedInterfaces?: Record<string, unknown> } } } };
    try {
      parsed = JSON.parse(Buffer.from(rawBody).toString("utf8"));
    } catch {
      return { status: 400, body: { error: "invalid request" } };
    }

    if (deps.verifyEnabled) {
      const timestamp = (parsed.request as { timestamp?: string }).timestamp ?? "";
      const result = await deps.verify({ rawBody, headers, timestamp });
      if (!result.ok) return { status: 401, body: { error: "unauthorized" } };
    }

    const aplSupported = parsed.context?.System?.device?.supportedInterfaces?.["Alexa.Presentation.APL"] !== undefined;
    const sessionId = parsed.session?.sessionId ?? "";
    const route = routeIntent(parsed);

    if (route.kind === "direct") {
      return {
        status: 200,
        body: buildAlexaResponse(
          {
            speech: route.speech,
            end: route.end,
            ...(route.end ? {} : { reprompt: route.speech })
          },
          { aplSupported }
        )
      };
    }

    const history = deps.sessions.history(sessionId);
    try {
      const result = await deps.agent.handle(route.utterance, history);
      deps.sessions.append(sessionId, [
        { role: "user", text: route.utterance },
        { role: "assistant", text: result.reply }
      ]);
      return {
        status: 200,
        body: buildAlexaResponse({ speech: result.reply, end: false, reprompt: "Is there anything else?", title: "Wayfinder", body: result.reply }, { aplSupported })
      };
    } catch (err) {
      console.error("[alexa] agent failed:", err);
      return { status: 200, body: buildAlexaResponse({ speech: APOLOGY, end: false, reprompt: "Please try again.", title: "Wayfinder", body: APOLOGY }, { aplSupported }) };
    }
  };
}
