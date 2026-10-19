export interface AlexaIntentRequest {
  request: {
    type: "LaunchRequest" | "IntentRequest" | "SessionEndedRequest" | string;
    intent?: { name: string; slots?: Record<string, { value?: string } | undefined> };
  };
}

export type RouteResult =
  | { kind: "speak"; utterance: string }
  | { kind: "direct"; speech: string; end: boolean };

const MAX_SLOT = 64;

const GREETING =
  "Wayfinder here. You can ask me what's due, what needs dealing with, or to prove your record.";
const HELP =
  "Ask me to read your mail, tell you what needs dealing with, what's due today, prove your record, or where something is.";
const REPHRASE = "Sorry, I didn't catch that. Try asking what's due today, or what needs dealing with.";
const GOODBYE = "Goodbye.";

function slot(request: AlexaIntentRequest, name: string): string | undefined {
  const value = request.request.intent?.slots?.[name]?.value;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, MAX_SLOT);
  return trimmed === "" ? undefined : trimmed;
}

export function routeIntent(request: AlexaIntentRequest): RouteResult {
  if (request.request.type === "LaunchRequest") return { kind: "direct", speech: GREETING, end: false };
  const name = request.request.intent?.name;
  switch (name) {
    case "ReadMailIntent":
      return { kind: "speak", utterance: "read my mail" };
    case "BacklogIntent":
      return { kind: "speak", utterance: "what do I need to deal with?" };
    case "DueTodayIntent":
      return { kind: "speak", utterance: "what's due today?" };
    case "ProveIntent":
      return { kind: "speak", utterance: "prove it" };
    case "WhereIsIntent": {
      const item = slot(request, "item");
      return item ? { kind: "speak", utterance: `where are my ${item}` } : { kind: "direct", speech: REPHRASE, end: false };
    }
    case "RememberIntent": {
      const item = slot(request, "item");
      const location = slot(request, "location");
      return item && location
        ? { kind: "speak", utterance: `remember my ${item} is at ${location}` }
        : { kind: "direct", speech: REPHRASE, end: false };
    }
    case "AMAZON.HelpIntent":
      return { kind: "direct", speech: HELP, end: false };
    case "AMAZON.StopIntent":
    case "AMAZON.CancelIntent":
      return { kind: "direct", speech: GOODBYE, end: true };
    default:
      return { kind: "direct", speech: REPHRASE, end: false };
  }
}
