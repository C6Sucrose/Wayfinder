export interface AlexaReply {
  speech: string;
  end: boolean;
  title?: string;
  body?: string;
  reprompt?: string;
}

interface AlexaOutputSpeech {
  type: "SSML";
  ssml: string;
}

interface AlexaSimpleCard {
  type: "Simple";
  title: string;
  content: string;
}

interface AlexaDirective {
  type: "Alexa.Presentation.APL.RenderDocument";
  document: typeof APL_DOCUMENT;
  datasources: { payload: { title: string; body: string } };
}

interface AlexaResponse {
  outputSpeech: AlexaOutputSpeech;
  shouldEndSession: boolean;
  card?: AlexaSimpleCard;
  reprompt?: { outputSpeech: AlexaOutputSpeech };
  directives?: AlexaDirective[];
}

const escape = (value: string): string =>
  value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );

export const APL_DOCUMENT = Object.freeze({
  type: "APL",
  version: "1.6",
  theme: "dark",
  mainTemplate: {
    parameters: ["payload"],
    items: [
      {
        type: "Container",
        paddingLeft: "5vw",
        paddingRight: "5vw",
        paddingTop: "4vh",
        items: [
          { type: "Text", text: "${payload.title}", fontSize: "40dp", fontWeight: "bold", color: "#F3F0EA" },
          { type: "Text", text: "${payload.body}", fontSize: "28dp", color: "#CFC9BD", paddingTop: "2vh" }
        ]
      }
    ]
  }
} as const);

export function buildAlexaResponse(
  reply: AlexaReply,
  options: { aplSupported: boolean }
): { version: "1.0"; response: AlexaResponse } {
  const response: AlexaResponse = {
    outputSpeech: { type: "SSML", ssml: `<speak>${escape(reply.speech)}</speak>` },
    shouldEndSession: reply.end
  };

  if (reply.title !== undefined) {
    response.card = { type: "Simple", title: reply.title, content: reply.body ?? "" };
  }

  if (reply.reprompt !== undefined && !reply.end) {
    response.reprompt = { outputSpeech: { type: "SSML", ssml: `<speak>${escape(reply.reprompt)}</speak>` } };
  }

  if (options.aplSupported && reply.title !== undefined) {
    response.directives = [
      {
        type: "Alexa.Presentation.APL.RenderDocument",
        document: APL_DOCUMENT,
        datasources: { payload: { title: reply.title, body: reply.body ?? "" } }
      }
    ];
  }

  return { version: "1.0", response };
}
