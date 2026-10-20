import { spawn } from "node:child_process";

const port = Number(process.env.SMOKE_PORT ?? 8099);
const host = "127.0.0.1";
const dataDir = process.env.WAYFINDER_DATA_DIR ?? "data";

const child = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
  env: {
    ...process.env,
    PORT: String(port),
    HOST: host,
    WAYFINDER_DATA_DIR: dataDir,
    WAYFINDER_ALEXA_VERIFY: "off"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const get = async (path: string): Promise<unknown> => {
  const response = await fetch(`http://${host}:${port}${path}`);
  if (!response.ok) throw new Error(`${path} -> ${response.status}`);
  return response.json();
};

const post = async (path: string, body: unknown): Promise<unknown> => {
  const response = await fetch(`http://${host}:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${path} -> ${response.status}`);
  return response.json();
};

const say = async (utterance: string): Promise<{ reply: string; brain: string }> => {
  const data = (await post("/api/agent", { utterance })) as { reply: string; brain: string };
  return { reply: data.reply, brain: data.brain };
};

const results: Array<{ level: "PASS" | "FAIL"; text: string }> = [];
const check = (ok: boolean, text: string): void => {
  results.push({ level: ok ? "PASS" : "FAIL", text });
};

try {
  let healthy = false;
  for (let attempt = 0; attempt < 60 && !healthy; attempt += 1) {
    try {
      const health = (await get("/healthz")) as { ok?: boolean };
      healthy = health.ok === true;
    } catch {
      await sleep(500);
    }
  }
  check(healthy, "server started and /healthz is healthy");
  if (healthy) {
    const capabilities = (await get("/capabilities")) as {
      brain?: { provider?: string };
      vision?: { provider?: string };
      channels?: { alexa?: string };
      adapters?: Record<string, string>;
    };
    check(capabilities.brain !== undefined, `capabilities brain: ${capabilities.brain?.provider ?? "missing"}`);
    check(capabilities.vision !== undefined, `capabilities vision: ${capabilities.vision?.provider ?? "missing"}`);
    check(capabilities.channels?.alexa !== undefined, `capabilities alexa channel: ${capabilities.channels?.alexa ?? "missing"}`);

    const backlog = (await say("what do I need to deal with?")) as { reply: string };
    check(backlog.reply.length > 0, `agent reply: ${backlog.reply.slice(0, 90)}`);

    const due = await say("what's due today?");
    check(due.reply.length > 0, `due reply: ${due.reply.slice(0, 90)}`);

    const prove = await say("prove it");
    check(/verif|hash|intact|record/i.test(prove.reply), `prove reply: ${prove.reply.slice(0, 90)}`);

    const keys = await say("where are my keys?");
    check(/kitchen counter/i.test(keys.reply), `object reply: ${keys.reply.slice(0, 90)}`);

    const alexaBody = {
      version: "1.0",
      session: { new: true, sessionId: "smoke-session", application: { applicationId: "amzn1.ask.skill.smoke" } },
      context: { System: { device: { supportedInterfaces: { "Alexa.Presentation.APL": {} } } } },
      request: {
        type: "IntentRequest",
        requestId: "smoke-request",
        timestamp: new Date().toISOString(),
        locale: "en-US",
        intent: { name: "ProveIntent", confirmationStatus: "NONE" }
      }
    };
    const alexa = (await post("/alexa", alexaBody)) as {
      response?: { outputSpeech?: { ssml?: string }; directives?: unknown[]; shouldEndSession?: boolean };
    };
    const ssml = alexa.response?.outputSpeech?.ssml ?? "";
    check(/<speak>/.test(ssml), `alexa ssml: ${ssml.slice(0, 80)}`);
    check(Array.isArray(alexa.response?.directives) && alexa.response.directives.length > 0, "alexa APL directive emitted for a screen device");

    const stale = { ...alexaBody, request: { ...alexaBody.request, timestamp: "2020-01-01T00:00:00Z" } };
    const staleResponse = await fetch(`http://${host}:${port}/alexa`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(stale)
    });
    check(staleResponse.status === 401, `alexa rejects a stale timestamp with 401 (got ${staleResponse.status})`);
  }
} catch (err) {
  check(false, `smoke run failed: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  child.kill();
  await sleep(300);
}

for (const result of results) console.log(`${result.level}  ${result.text}`);
const failures = results.filter((result) => result.level === "FAIL").length;
if (failures > 0) {
  console.log("\n--- server output ---");
  console.log(output.trim());
}
console.log(failures === 0 ? "\nSmoke test OK." : `\n${failures} smoke failure(s).`);
process.exit(failures === 0 ? 0 : 1);
