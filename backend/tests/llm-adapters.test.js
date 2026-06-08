// ═══════════════════════════════════════════════════════════════════════
// tests/llm-adapters.test.js — provider detection, round-trip, error norm
// ═══════════════════════════════════════════════════════════════════════

import test from "node:test";
import assert from "node:assert/strict";
import {
  callLLM,
  detectProvider,
  isReasonableModelId,
  listProviders,
  PROVIDERS,
  TIER_DEFAULTS,
} from "../llm-adapters/index.js";

// ─── Helpers: build fake fetch impls for each provider ─────────────────

function fakeAnthropicResponse(text = "hi from claude", usage = { input_tokens: 10, output_tokens: 5 }) {
  return {
    ok: true,
    status: 200,
    headers: new Map(),
    json: async () => ({
      id: "msg_1",
      model: "claude-haiku-4-5-20251001",
      content: [{ type: "text", text }],
      usage,
      stop_reason: "end_turn",
    }),
  };
}

function fakeOpenAIResponse(text = "hi from gpt", usage = { prompt_tokens: 8, completion_tokens: 3 }, model = "gpt-4o-mini") {
  return {
    ok: true,
    status: 200,
    headers: new Map(),
    json: async () => ({
      id: "chatcmpl-1",
      model,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage,
    }),
  };
}

function fakeGoogleResponse(text = "hi from gemini") {
  return {
    ok: true,
    status: 200,
    headers: new Map(),
    json: async () => ({
      candidates: [
        { content: { parts: [{ text }], role: "model" }, finishReason: "STOP" },
      ],
      usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 4, totalTokenCount: 10 },
    }),
  };
}

function fakeErrorResponse(status, message) {
  return {
    ok: false,
    status,
    headers: new Map(),
    json: async () => ({ error: { message } }),
  };
}

// ─── detectProvider ────────────────────────────────────────────────────

test("detectProvider: sk-ant-* → anthropic", () => {
  assert.equal(detectProvider({ apiKey: "sk-ant-api03-abc" }), PROVIDERS.ANTHROPIC);
});

test("detectProvider: sk-proj-* and sk-* → openai", () => {
  assert.equal(detectProvider({ apiKey: "sk-proj-abc123" }), PROVIDERS.OPENAI);
  assert.equal(detectProvider({ apiKey: "sk-abc123" }), PROVIDERS.OPENAI);
});

test("detectProvider: AIza* → google", () => {
  assert.equal(detectProvider({ apiKey: "AIzaSyAbC" }), PROVIDERS.GOOGLE);
});

test("detectProvider: sk-or-* → openrouter", () => {
  assert.equal(detectProvider({ apiKey: "sk-or-v1-abc" }), PROVIDERS.OPENROUTER);
});

test("detectProvider: explicit provider overrides key prefix", () => {
  assert.equal(
    detectProvider({ apiKey: "sk-ant-abc", provider: "openai_compat" }),
    PROVIDERS.OPENAI_COMPAT,
  );
});

test("detectProvider: baseUrl host hints take effect", () => {
  assert.equal(
    detectProvider({ apiKey: "any", baseUrl: "https://openrouter.ai/api/v1" }),
    PROVIDERS.OPENROUTER,
  );
  assert.equal(
    detectProvider({ apiKey: "any", baseUrl: "http://localhost:11434/v1" }),
    PROVIDERS.OLLAMA,
  );
  assert.equal(
    detectProvider({ apiKey: "any", baseUrl: "https://api.deepseek.com" }),
    PROVIDERS.DEEPSEEK,
  );
});

test("detectProvider: unknown baseUrl with key → openai_compat", () => {
  assert.equal(
    detectProvider({ apiKey: "somekey", baseUrl: "https://internal.example.com/v1" }),
    PROVIDERS.OPENAI_COMPAT,
  );
});

test("detectProvider: no signal → null", () => {
  assert.equal(detectProvider({}), null);
  assert.equal(detectProvider({ apiKey: "gibberish" }), null);
});

// ─── isReasonableModelId ───────────────────────────────────────────────

test("isReasonableModelId accepts well-formed ids", () => {
  assert.ok(isReasonableModelId("claude-haiku-4-5-20251001"));
  assert.ok(isReasonableModelId("gpt-4o-mini"));
  assert.ok(isReasonableModelId("anthropic/claude-sonnet-4"));
  assert.ok(isReasonableModelId("llama3.2:3b"));
  assert.ok(isReasonableModelId("Qwen/Qwen2.5-72B-Instruct-Turbo"));
  assert.ok(isReasonableModelId("o3-mini"));
});

test("isReasonableModelId rejects whitespace, control chars, oversize, non-string", () => {
  assert.equal(isReasonableModelId(""), false);
  assert.equal(isReasonableModelId("ab"), false);                 // too short
  assert.equal(isReasonableModelId("a".repeat(121)), false);      // too long
  assert.equal(isReasonableModelId("bad model"), false);          // whitespace
  assert.equal(isReasonableModelId("bad\nmodel"), false);         // newline
  assert.equal(isReasonableModelId("bad\tmodel"), false);         // tab
  assert.equal(isReasonableModelId("bad\x00model"), false);       // null byte
  assert.equal(isReasonableModelId("; DROP TABLE"), false);       // whitespace+;
  assert.equal(isReasonableModelId(null), false);
  assert.equal(isReasonableModelId(undefined), false);
  assert.equal(isReasonableModelId(123), false);
  assert.equal(isReasonableModelId({}), false);
});

// ─── callLLM round-trip — Anthropic wire ───────────────────────────────

test("callLLM (anthropic) round-trips content + usage", async () => {
  let capturedUrl;
  let capturedHeaders;
  let capturedBody;
  const fetchImpl = async (url, opts) => {
    capturedUrl = url;
    capturedHeaders = opts.headers;
    capturedBody = JSON.parse(opts.body);
    return fakeAnthropicResponse();
  };
  const r = await callLLM({
    provider: "anthropic",
    apiKey: "sk-ant-test",
    model: "claude-haiku-4-5-20251001",
    system: "be brief",
    messages: [{ role: "user", content: "hi" }],
    maxTokens: 16,
    fetchImpl,
  });
  assert.equal(capturedUrl, "https://api.anthropic.com/v1/messages");
  assert.equal(capturedHeaders["x-api-key"], "sk-ant-test");
  assert.equal(capturedBody.model, "claude-haiku-4-5-20251001");
  // System prompt is wrapped in a cache_control block for prompt caching.
  assert.deepEqual(capturedBody.system, [
    { type: "text", text: "be brief", cache_control: { type: "ephemeral" } },
  ]);
  assert.equal(r.content[0].text, "hi from claude");
  assert.equal(r.usage.input_tokens, 10);
  assert.equal(r.usage.output_tokens, 5);
});

// ─── callLLM round-trip — OpenAI wire ──────────────────────────────────

test("callLLM (openai) translates system prompt and flattens content blocks", async () => {
  let capturedBody;
  const fetchImpl = async (_url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return fakeOpenAIResponse();
  };
  const r = await callLLM({
    provider: "openai",
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    system: "you are a counselor",
    messages: [
      { role: "user", content: [{ type: "text", text: "part 1" }, { type: "text", text: "part 2" }] },
    ],
    fetchImpl,
  });
  // System prompt should be prepended as a system message.
  assert.equal(capturedBody.messages[0].role, "system");
  assert.equal(capturedBody.messages[0].content, "you are a counselor");
  // Multi-block content collapses into a string.
  assert.equal(capturedBody.messages[1].role, "user");
  assert.ok(capturedBody.messages[1].content.includes("part 1"));
  assert.ok(capturedBody.messages[1].content.includes("part 2"));
  // Response is Anthropic-shaped.
  assert.equal(r.content[0].type, "text");
  assert.equal(r.content[0].text, "hi from gpt");
  assert.equal(r.usage.input_tokens, 8);
  assert.equal(r.usage.output_tokens, 3);
  assert.equal(r.stop_reason, "stop");
});

test("callLLM (openai) honors custom baseUrl for OpenRouter/DeepSeek/Ollama", async () => {
  let capturedUrl;
  const fetchImpl = async (url, _opts) => { capturedUrl = url; return fakeOpenAIResponse(); };
  await callLLM({
    provider: "openrouter",
    apiKey: "sk-or-test",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "anthropic/claude-sonnet-4",
    messages: [{ role: "user", content: "hi" }],
    fetchImpl,
  });
  assert.equal(capturedUrl, "https://openrouter.ai/api/v1/chat/completions");
});

// ─── callLLM round-trip — Google wire ──────────────────────────────────

test("callLLM (google) converts system → systemInstruction and parses candidates", async () => {
  let capturedUrl;
  let capturedBody;
  const fetchImpl = async (url, opts) => {
    capturedUrl = url;
    capturedBody = JSON.parse(opts.body);
    return fakeGoogleResponse();
  };
  const r = await callLLM({
    provider: "google",
    apiKey: "AIza-test",
    model: "gemini-2.0-flash",
    system: "you are a counselor",
    messages: [{ role: "user", content: "hi" }],
    fetchImpl,
  });
  // URL contains the key as a query param and the model in the path.
  assert.ok(capturedUrl.includes("gemini-2.0-flash"));
  assert.ok(capturedUrl.includes("key=AIza-test"));
  // systemInstruction is a separate field, not a message.
  assert.equal(capturedBody.systemInstruction.parts[0].text, "you are a counselor");
  // Messages become `contents` with role={user|model}.
  assert.equal(capturedBody.contents[0].role, "user");
  assert.equal(capturedBody.contents[0].parts[0].text, "hi");
  // Response unwrapped.
  assert.equal(r.content[0].text, "hi from gemini");
  assert.equal(r.usage.input_tokens, 6);
  assert.equal(r.usage.output_tokens, 4);
});

// ─── Error normalization ───────────────────────────────────────────────

test("callLLM normalizes 401 → auth_rejected across providers", async () => {
  const providers = [
    { id: "anthropic", apiKey: "sk-ant-x", model: "claude-haiku-4-5-20251001" },
    { id: "openai",    apiKey: "sk-x",     model: "gpt-4o-mini" },
    { id: "google",    apiKey: "AIza-x",   model: "gemini-2.0-flash" },
  ];
  for (const p of providers) {
    const fetchImpl = async () => fakeErrorResponse(401, "unauthorized");
    await assert.rejects(
      () => callLLM({
        provider: p.id, apiKey: p.apiKey, model: p.model,
        messages: [{ role: "user", content: "hi" }], fetchImpl,
      }),
      (err) => {
        assert.equal(err.status, 401);
        assert.equal(err.code, "auth_rejected");
        assert.equal(err.provider, p.id);
        return true;
      },
    );
  }
});

test("callLLM rejects bogus model id before hitting network", async () => {
  let hit = false;
  const fetchImpl = async () => { hit = true; return fakeAnthropicResponse(); };
  await assert.rejects(
    () => callLLM({
      provider: "anthropic",
      apiKey: "sk-ant-x",
      model: "bad model with spaces",
      messages: [{ role: "user", content: "hi" }],
      fetchImpl,
    }),
    (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.code, "invalid_model");
      return true;
    },
  );
  assert.equal(hit, false, "network should never have been touched");
});

// ─── AbortSignal plumbing ──────────────────────────────────────────────

test("callLLM propagates AbortSignal to fetch", async () => {
  let receivedSignal;
  const fetchImpl = async (_url, opts) => {
    receivedSignal = opts.signal;
    return fakeAnthropicResponse();
  };
  const controller = new AbortController();
  await callLLM({
    provider: "anthropic",
    apiKey: "sk-ant-x",
    model: "claude-haiku-4-5-20251001",
    messages: [{ role: "user", content: "hi" }],
    signal: controller.signal,
    fetchImpl,
  });
  assert.equal(receivedSignal, controller.signal);
});

// ─── Tier resolution ───────────────────────────────────────────────────

test("callLLM resolves tier name to TIER_DEFAULTS model", async () => {
  let capturedBody;
  const fetchImpl = async (_url, opts) => { capturedBody = JSON.parse(opts.body); return fakeOpenAIResponse(); };
  await callLLM({
    provider: "openai",
    apiKey: "sk-test",
    tier: "small",
    messages: [{ role: "user", content: "hi" }],
    fetchImpl,
  });
  assert.equal(capturedBody.model, TIER_DEFAULTS.openai.small);
});

// ─── Tool-use forwarding (Anthropic web_search) ────────────────────────

test("callLLM forwards `tools` + `tool_choice` to Anthropic unchanged", async () => {
  let capturedBody;
  const fetchImpl = async (_url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        id: "msg_1",
        model: "claude-haiku-4-5-20251001",
        // Anthropic returns tool_use blocks when the model invokes a tool.
        content: [
          { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "USAMO" } },
          { type: "web_search_tool_result", tool_use_id: "srv_1", content: [] },
          { type: "text", text: "{\"score\":0.9}" },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
        stop_reason: "end_turn",
      }),
    };
  };

  const tools = [
    {
      type: "web_search_20250305",
      name: "web_search",
      max_uses: 3,
      allowed_domains: ["maa.org", "en.wikipedia.org"],
    },
  ];
  const r = await callLLM({
    provider: "anthropic",
    apiKey: "sk-ant-x",
    model: "claude-haiku-4-5-20251001",
    messages: [{ role: "user", content: "research USAMO" }],
    tools,
    toolChoice: { type: "auto" },
    fetchImpl,
  });

  // Request body: tools forwarded with cache_control on the last entry
  // (prompt-caching optimization — tool schemas are stable per session).
  assert.equal(capturedBody.tools.length, 1);
  assert.equal(capturedBody.tools[0].type, "web_search_20250305");
  assert.equal(capturedBody.tools[0].name, "web_search");
  assert.deepEqual(capturedBody.tools[0].allowed_domains, tools[0].allowed_domains);
  assert.deepEqual(capturedBody.tools[0].cache_control, { type: "ephemeral" });
  assert.deepEqual(capturedBody.tool_choice, { type: "auto" });
  // Response: caller should see all content blocks (tool_use + text).
  assert.equal(r.content.length, 3);
  assert.equal(r.content[2].text, '{"score":0.9}');
});

test("callLLM rejects tools with tools_unsupported for non-Anthropic providers", async () => {
  let hit = false;
  const fetchImpl = async () => { hit = true; return fakeOpenAIResponse(); };
  await assert.rejects(
    () => callLLM({
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      fetchImpl,
    }),
    (err) => {
      assert.equal(err.code, "tools_unsupported");
      assert.equal(err.provider, "openai");
      return true;
    },
  );
  assert.equal(hit, false, "non-Anthropic tool call must short-circuit before fetch");
});

test("callLLM (openrouter) emits plugins:[{id:'web'}] when webPlugin is enabled", async () => {
  let capturedBody;
  const fetchImpl = async (_url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return fakeOpenAIResponse();
  };
  await callLLM({
    provider: "openrouter",
    apiKey: "sk-or-test",
    model: "z-ai/glm-5.1",
    messages: [{ role: "user", content: "research USAMO" }],
    webPlugin: { enabled: true, allowedDomains: ["maa.org", "en.wikipedia.org"] },
    fetchImpl,
  });
  assert.ok(Array.isArray(capturedBody.plugins), "plugins[] must be set");
  assert.equal(capturedBody.plugins.length, 1);
  assert.equal(capturedBody.plugins[0].id, "web");
  assert.match(capturedBody.plugins[0].search_prompt || "", /maa\.org/);
});

test("callLLM (openrouter) accepts Anthropic-shape tools when webPlugin enabled (passthrough route)", async () => {
  // When the OpenRouter route is web-plugin-enabled, callers may still
  // pass web_search tool blocks (server.js does this on the Anthropic
  // passthrough branch). The dispatcher should NOT throw tools_unsupported
  // in that case — adapter just ignores the tools and uses the plugin.
  let hit = false;
  const fetchImpl = async (_url, opts) => {
    hit = true;
    return fakeOpenAIResponse();
  };
  await callLLM({
    provider: "openrouter",
    apiKey: "sk-or-test",
    model: "z-ai/glm-5.1",
    messages: [{ role: "user", content: "hi" }],
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    webPlugin: { enabled: true, allowedDomains: ["maa.org"] },
    fetchImpl,
  });
  assert.equal(hit, true, "should reach fetch instead of throwing tools_unsupported");
});

// ─── listProviders ─────────────────────────────────────────────────────

test("listProviders returns stable registry with tier defaults", () => {
  const ps = listProviders();
  assert.ok(ps.length >= 8);
  const anthro = ps.find((p) => p.id === "anthropic");
  assert.ok(anthro);
  assert.equal(anthro.keyPrefix, "sk-ant-");
  assert.ok(anthro.defaults);
  assert.ok(anthro.defaults.small.startsWith("claude-"));
  const google = ps.find((p) => p.id === "google");
  assert.ok(google);
  assert.ok(google.defaults.small.startsWith("gemini-"));
});
