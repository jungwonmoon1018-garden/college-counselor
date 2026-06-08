#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const TEXT_EXTENSIONS = new Set([".js", ".mjs", ".json", ".md", ".txt", ".html", ".css"]);
const EXCLUDED_DIRS = new Set(["node_modules", ".git", "data"]);
const CODE_RESOURCE_EXTENSIONS = new Set([".js", ".mjs", ".json", ".md"]);

function readText(relativePath) {
  const resolved = path.resolve(ROOT, relativePath);
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) {
    throw new Error("Path escapes repository root");
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error("File not found");
  }
  const ext = path.extname(resolved);
  if (!TEXT_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file extension: ${ext}`);
  }
  return fs.readFileSync(resolved, "utf8");
}

function routeScan() {
  const source = readText("server.js");
  const routes = [];
  const regex = /app\.(get|post|put|patch|delete)\("([^"]+)"/g;
  let match;
  while ((match = regex.exec(source))) {
    const line = source.slice(0, match.index).split(/\r?\n/).length;
    routes.push({ method: match[1].toUpperCase(), path: match[2], line });
  }
  return routes;
}

function walk(dir = ROOT, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (TEXT_EXTENSIONS.has(path.extname(entry.name))) out.push(path.relative(ROOT, full).replace(/\\/g, "/"));
  }
  return out;
}

function architectureSummary() {
  const routes = routeScan();
  const files = walk().filter((file) => !file.startsWith("tests/"));
  const modules = files.filter((file) => file.endsWith(".js") || file.endsWith(".mjs"));
  return {
    generatedAt: new Date().toISOString(),
    root: ROOT,
    databases: ["counselor.db", "pii-vault.db", "vectors.db", "simulated-profiles.db", "simulated-vectors.db"],
    routeCounts: routes.reduce((acc, route) => {
      acc[route.method] = (acc[route.method] || 0) + 1;
      return acc;
    }, {}),
    simulationBoundary: {
      publicPrefix: "/api/simulations",
      sidecarPortEnv: "SIM_PORT",
      disallowedPrefixes: ["/api/students", "/api/positioning", "/api/ec", "/api/directionality", "/api/ap-concepts"],
    },
    redactionBoundary: {
      sanitizer: "content-moderation.js:sanitizeProviderPayload",
      providerDispatch: "llm-adapters/index.js:callLLM",
      legacyAnthropic: "orchestration-engine.js:redactPayloadForModel",
    },
    coreModules: modules.filter((file) => [
      "server.js",
      "simulation-engine.js",
      "simulation-sidecar.js",
      "vector-store.js",
      "rag-engine.js",
      "positioning-engine.js",
    ].includes(file)),
  };
}

function simulationDesign() {
  return {
    storage: {
      profiles: "data/simulated-profiles.db",
      vectors: "data/simulated-vectors.db",
      ttl: "SIM_TTL_DAYS, default 7",
    },
    routes: {
      mainApi: ["/api/simulations", "/api/simulations/:id"],
      sidecar: ["/simulations", "/simulations/:id", "/health"],
    },
    invariants: [
      "Simulation writes never target counselor.db, pii-vault.db, or vectors.db.",
      "Simulation routes never mount under actual student/vector/positioning prefixes.",
      "Sidecar accepts only x-simulation-internal-token authenticated requests.",
      "Resources are generated from current files on each MCP request.",
    ],
  };
}

function llmProviderArchitecture() {
  return {
    providerBoundary: "llm-adapters/index.js:callLLM",
    sanitizer: "content-moderation.js:sanitizeProviderPayload",
    legacyDirectPath: "server.js:/api/anthropic uses orchestration-engine.js:redactPayloadForModel before fetch",
    routes: {
      providerNeutral: "/api/llm",
      legacyAnthropic: "/api/anthropic",
      orchestration: "/api/agents/orchestrate",
    },
    internalCallers: ["competition-research.js", "narrative-fit-llm.js"],
    invariant: "Every external provider payload is sanitized before it reaches fetchImpl/global fetch.",
  };
}

function piiRedactionMap() {
  return {
    textPatterns: ["email", "phone", "ssn", "financial", "street_address", "student_id", "contextual student name", "contextual school"],
    nonRestorable: ["ssn", "phone", "financial", "street_address", "student_id", "api_key", "password"],
    restorable: ["email", "contextual student name", "contextual school"],
    structuredSanitization: ["metadata.fafsaProfile raw tax/income/asset fields"],
    outputScreening: "content-moderation.js:screenOutput",
  };
}

function verifySimulationBoundaries() {
  const routes = routeScan();
  const simulated = routes.filter((route) => route.path.includes("simulation"));
  const disallowed = ["/api/students", "/api/positioning", "/api/ec", "/api/directionality", "/api/ap-concepts"];
  const collisions = simulated.filter((route) => disallowed.some((prefix) => route.path.startsWith(prefix)));
  const server = readText("server.js");
  return {
    ok: collisions.length === 0 && server.includes("/api/simulations") && server.includes("callSimulationSidecar"),
    simulatedRoutes: simulated,
    collisions,
    sidecarFilesPresent: fs.existsSync(path.join(ROOT, "simulation-sidecar.js")) && fs.existsSync(path.join(ROOT, "simulation-engine.js")),
  };
}

function verifyLlmRedactionBoundaries() {
  const adapter = readText("llm-adapters/index.js");
  const server = readText("server.js");
  const competition = readText("competition-research.js");
  const narrative = readText("narrative-fit-llm.js");
  const content = readText("content-moderation.js");
  const issues = [];

  if (!content.includes("export function sanitizeProviderPayload")) {
    issues.push("content-moderation.js does not export sanitizeProviderPayload");
  }
  if (!adapter.includes("sanitizeProviderPayload") || !adapter.includes("sanitizedPayload.messages")) {
    issues.push("llm-adapters/index.js does not sanitize provider payloads before dispatch");
  }
  // Legacy /api/anthropic path: PII must be redacted before dispatch. The
  // redacted payload is assigned back to `payload` (then sent as the fetch
  // body, possibly wrapped with tools as `bodyWithTools`), so verify the
  // redaction + assignment rather than a brittle exact fetch-body literal.
  if (!server.includes("redactPayloadForModel(payload, studentId)") || !server.includes("payload = redacted.payload")) {
    issues.push("legacy /api/anthropic redaction path not found");
  }
  if (!server.includes("redaction: resp._redaction") || !server.includes("redaction: redacted.redactionReport")) {
    issues.push("server responses do not expose redaction reports for both LLM paths");
  }
  for (const [file, source] of [["competition-research.js", competition], ["narrative-fit-llm.js", narrative]]) {
    if (source.includes("callLLM(") && !adapter.includes("sanitizeProviderPayload")) {
      issues.push(`${file} calls callLLM but adapter sanitizer is missing`);
    }
  }

  const directFetches = [];
  for (const file of walk().filter((f) => f.endsWith(".js") || f.endsWith(".mjs"))) {
    if (file.startsWith("node_modules/")) continue;
    const source = readText(file);
    if (/fetch\([^)]*api\.anthropic\.com|fetch\([^)]*api\.openai\.com|fetch\([^)]*generativelanguage\.googleapis\.com/s.test(source)) {
      directFetches.push(file);
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    directProviderFetches: [...new Set(directFetches)],
    callLlmCallers: walk()
      .filter((f) => (f.endsWith(".js") || f.endsWith(".mjs")) && !f.startsWith("node_modules/"))
      .filter((f) => readText(f).includes("callLLM(")),
  };
}

function contentResponse(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function resourceContent(uri) {
  if (uri === "repo://architecture") return JSON.stringify(architectureSummary(), null, 2);
  if (uri === "repo://routes") return JSON.stringify(routeScan(), null, 2);
  if (uri === "repo://simulation-design") return JSON.stringify(simulationDesign(), null, 2);
  if (uri === "repo://llm-provider-architecture") return JSON.stringify(llmProviderArchitecture(), null, 2);
  if (uri === "repo://pii-redaction-map") return JSON.stringify(piiRedactionMap(), null, 2);
  if (uri.startsWith("repo://files/")) return readText(uri.slice("repo://files/".length));
  throw new Error(`Unknown resource: ${uri}`);
}

const handlers = {
  initialize: () => ({
    protocolVersion: "2024-11-05",
    capabilities: { resources: {}, tools: {} },
    serverInfo: { name: "college-counselor-codebase", version: "1.0.0" },
  }),
  "resources/list": () => ({
    resources: [
      { uri: "repo://architecture", name: "Current architecture", mimeType: "application/json" },
      { uri: "repo://routes", name: "Current Express routes", mimeType: "application/json" },
      { uri: "repo://simulation-design", name: "Simulation sidecar design", mimeType: "application/json" },
      { uri: "repo://llm-provider-architecture", name: "LLM provider redaction architecture", mimeType: "application/json" },
      { uri: "repo://pii-redaction-map", name: "PII redaction map", mimeType: "application/json" },
      ...walk()
        .filter((file) => CODE_RESOURCE_EXTENSIONS.has(path.extname(file)))
        .filter((file) => !file.startsWith("tools/cds-cache/"))
        .map((file) => ({
          uri: `repo://files/${file}`,
          name: file,
          mimeType: file.endsWith(".js") || file.endsWith(".mjs") ? "text/javascript" : "text/plain",
        })),
    ],
  }),
  "resources/read": (params) => ({
    contents: [{ uri: params.uri, mimeType: params.uri.endsWith(".js") ? "text/javascript" : "application/json", text: resourceContent(params.uri) }],
  }),
  "tools/list": () => ({
    tools: [
      { name: "scan_architecture", description: "Scan current architecture summary from repository files.", inputSchema: { type: "object", properties: {} } },
      { name: "list_routes", description: "List current Express routes from server.js.", inputSchema: { type: "object", properties: {} } },
      { name: "read_code_file", description: "Read a text source file by repository-relative path.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
      { name: "verify_simulation_boundaries", description: "Verify simulation routes do not collide with actual student/vector routes.", inputSchema: { type: "object", properties: {} } },
      { name: "verify_llm_redaction_boundaries", description: "Verify model-provider calls pass through the shared PII sanitizer.", inputSchema: { type: "object", properties: {} } },
    ],
  }),
  "tools/call": (params) => {
    if (params.name === "scan_architecture") return contentResponse(architectureSummary());
    if (params.name === "list_routes") return contentResponse(routeScan());
    if (params.name === "read_code_file") return contentResponse(readText(params.arguments?.path || ""));
    if (params.name === "verify_simulation_boundaries") return contentResponse(verifySimulationBoundaries());
    if (params.name === "verify_llm_redaction_boundaries") return contentResponse(verifyLlmRedactionBoundaries());
    throw new Error(`Unknown tool: ${params.name}`);
  },
};

let buffer = Buffer.alloc(0);

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function tryReadMessages() {
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!lengthMatch) {
      buffer = Buffer.alloc(0);
      return;
    }
    const length = Number(lengthMatch[1]);
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + length;
    if (buffer.length < messageEnd) return;
    const raw = buffer.slice(messageStart, messageEnd).toString("utf8");
    buffer = buffer.slice(messageEnd);
    const request = JSON.parse(raw);
    if (!request.id) continue;
    try {
      const handler = handlers[request.method];
      if (!handler) throw new Error(`Unsupported method: ${request.method}`);
      send({ jsonrpc: "2.0", id: request.id, result: handler(request.params || {}) });
    } catch (err) {
      send({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: err.message } });
    }
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  tryReadMessages();
});
