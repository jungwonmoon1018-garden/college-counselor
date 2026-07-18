import fs from "node:fs";

const realFetch = globalThis.fetch;
const callLogPath = process.env.TEST_OPENROUTER_CALL_LOG;
const models = [
  "google/gemma-4-26b-a4b-it",
  "google/gemma-4-31b-it",
  "deepseek/deepseek-v4-pro",
];

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input?.url;

  if (url === "https://openrouter.ai/api/v1/models") {
    return Response.json({
      data: models.map((id) => ({
        id,
        name: id,
        context_length: 32_768,
        pricing: { prompt: "0.0000001", completion: "0.0000002" },
      })),
    });
  }

  if (url === "https://openrouter.ai/api/v1/chat/completions") {
    const body = JSON.parse(String(init.body || "{}"));
    if (callLogPath) fs.appendFileSync(callLogPath, `${JSON.stringify(body)}\n`, "utf8");
    return Response.json({
      id: "mock-autoname",
      model: body.model,
      choices: [{
        index: 0,
        message: { role: "assistant", content: "\"Junior Year Course Plan.\"" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 20, completion_tokens: 5 },
    });
  }

  if (/^https?:/i.test(String(url || ""))) {
    throw new Error(`Unexpected external request in route integration test: ${url}`);
  }

  return realFetch(input, init);
};
