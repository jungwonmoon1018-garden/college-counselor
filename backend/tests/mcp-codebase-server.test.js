import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, "..");

function encodeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"),
    body,
  ]);
}

function createMcpClient() {
  const child = spawn(process.execPath, ["tools/mcp-codebase-server.mjs"], {
    cwd: PROJECT_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let nextId = 1;
  let buffer = Buffer.alloc(0);
  const pending = new Map();

  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = buffer.slice(0, headerEnd).toString("utf8");
      const length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1]);
      const start = headerEnd + 4;
      const end = start + length;
      if (!length || buffer.length < end) return;
      const message = JSON.parse(buffer.slice(start, end).toString("utf8"));
      buffer = buffer.slice(end);
      const deferred = pending.get(message.id);
      if (deferred) {
        pending.delete(message.id);
        if (message.error) deferred.reject(new Error(message.error.message));
        else deferred.resolve(message.result);
      }
    }
  });

  function request(method, params = {}) {
    const id = nextId++;
    child.stdin.write(encodeMessage({ jsonrpc: "2.0", id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), 5000);
    });
  }

  return { child, request };
}

test("MCP server exposes fresh codebase resources and boundary tools", async () => {
  const client = createMcpClient();
  try {
    const init = await client.request("initialize", {});
    assert.equal(init.serverInfo.name, "college-counselor-codebase");

    const resources = await client.request("resources/list", {});
    assert.ok(resources.resources.some((r) => r.uri === "repo://architecture"));
    assert.ok(resources.resources.some((r) => r.uri === "repo://routes"));
    assert.ok(resources.resources.some((r) => r.uri === "repo://simulation-design"));
    assert.ok(resources.resources.some((r) => r.uri === "repo://llm-provider-architecture"));
    assert.ok(resources.resources.some((r) => r.uri === "repo://pii-redaction-map"));

    const routes = await client.request("resources/read", { uri: "repo://routes" });
    const parsedRoutes = JSON.parse(routes.contents[0].text);
    assert.ok(parsedRoutes.some((r) => r.path === "/api/simulations"));

    const tools = await client.request("tools/list", {});
    assert.ok(tools.tools.some((t) => t.name === "verify_simulation_boundaries"));
    assert.ok(tools.tools.some((t) => t.name === "verify_llm_redaction_boundaries"));

    const boundary = await client.request("tools/call", { name: "verify_simulation_boundaries", arguments: {} });
    const boundaryResult = JSON.parse(boundary.content[0].text);
    assert.equal(boundaryResult.ok, true);
    assert.equal(boundaryResult.collisions.length, 0);

    const redaction = await client.request("tools/call", { name: "verify_llm_redaction_boundaries", arguments: {} });
    const redactionResult = JSON.parse(redaction.content[0].text);
    assert.equal(redactionResult.ok, true);

    const file = await client.request("tools/call", { name: "read_code_file", arguments: { path: "simulation-engine.js" } });
    assert.match(file.content[0].text, /createSimulation/);
  } finally {
    client.child.kill("SIGTERM");
  }
});
