import type { AgentService } from "../agent/service.js";
import { routeIntent, type AlexaIntentRequest } from "./intents.js";
import { buildAlexaResponse } from "./response.js";
import type { SessionStore } from "./sessions.js";
import type { VerifyInput, VerifyResult } from "./types.js";
import { timestampFresh } from "./verify.js";

export interface AlexaDeps {
  verify: (input: VerifyInput) => Promise<VerifyResult>;
  agent: AgentService;
  sessions: SessionStore;
  verifyEnabled: boolean;
  appId?: string;
}

export interface AlexaHttpResult {
  status: number;
  body: unknown;
}

const APOLOGY = "Sorry, I couldn't do that. Please try again.";

type AlexaEnvelope = AlexaIntentRequest & {
  version?: string;
  session?: { sessionId?: string; application?: { applicationId?: string } };
  context?: { System?: { device?: { supportedInterfaces?: Record<string, unknown> } } };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createAlexaHandler(deps: AlexaDeps) {
  return async (rawBody: Uint8Array, headers: VerifyInput["headers"] = {}): Promise<AlexaHttpResult> => {
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(rawBody).toString("utf8"));
      } catch {
        return { status: 400, body: { error: "invalid request" } };
      }

      if (!isRecord(parsed) || !isRecord(parsed.request)) {
        return { status: 400, body: { error: "invalid request" } };
      }

      const envelope = parsed as unknown as AlexaEnvelope;

      const rawTimestamp = (envelope.request as { timestamp?: unknown }).timestamp;
      if (typeof rawTimestamp !== "string") {
        return { status: 400, body: { error: "invalid request" } };
      }
      if (!timestampFresh(rawTimestamp)) {
        return { status: 401, body: { error: "unauthorized" } };
      }

      if (deps.verifyEnabled) {
        let verification: VerifyResult;
        try {
          verification = await deps.verify({ rawBody, headers, timestamp: rawTimestamp });
        } catch {
          return { status: 401, body: { error: "unauthorized" } };
        }
        if (!verification.ok) return { status: 401, body: { error: "unauthorized" } };
      }

      if (deps.appId !== undefined && envelope.session?.application?.applicationId !== deps.appId) {
        return { status: 401, body: { error: "unauthorized" } };
      }

      const aplSupported = envelope.context?.System?.device?.supportedInterfaces?.["Alexa.Presentation.APL"] !== undefined;
      const sessionId = envelope.session?.sessionId ?? "";
      const route = routeIntent(envelope);

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
        console.error(`[alexa] agent failed: ${err instanceof Error ? err.name : "Error"}`);
        return { status: 200, body: buildAlexaResponse({ speech: APOLOGY, end: false, reprompt: "Please try again.", title: "Wayfinder", body: APOLOGY }, { aplSupported }) };
      }
    } catch {
      return { status: 500, body: { error: "internal error" } };
    }
  };
}
