import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const FETCH_MOCK = path.join(__dirname, "helpers", "mock-openrouter-fetch.mjs");

let baseUrl;
let callLogPath;
let serverOutput = "";
let serverProcess;
let testDataDir;

function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const { port } = listener.address();
      listener.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (serverProcess?.exitCode != null) {
      throw new Error(`Route-test server exited early (${serverProcess.exitCode}).\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Timed out waiting for route-test server.\n${serverOutput}`);
}

async function request(method, pathname, { body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    data: text ? JSON.parse(text) : null,
  };
}

async function registerStudent(label) {
  const result = await request("POST", "/api/students/register", {
    body: {
      email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
      password: "correct horse battery staple",
      grade: 11,
      state: "CA",
      schoolDomain: "example.edu",
      majorInterest: "Computer Science",
    },
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.ok(result.data.token);
  return result.data.token;
}

async function createThread(token, title = "New conversation") {
  const result = await request("POST", "/api/students/threads", { token, body: { title } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.ok(result.data.id);
  return result.data.id;
}

async function appendUserMessage(token, threadId, content) {
  return request("POST", `/api/students/threads/${threadId}/messages`, {
    token,
    body: { role: "user", content },
  });
}

async function createDeadline(token, title, collegeIds = null) {
  const result = await request("POST", "/api/students/deadlines", {
    token,
    body: {
      title,
      dueAt: "2027-12-01T12:00:00.000Z",
      category: "admissions",
      collegeIds,
    },
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.deadline;
}

async function listDeadlineTitles(token) {
  const result = await request("GET", "/api/students/deadlines", { token });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data.deadlines.map((deadline) => deadline.title);
}

function loggedModelCalls() {
  if (!fs.existsSync(callLogPath)) return [];
  return fs.readFileSync(callLogPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

before(async () => {
  const port = await freePort();
  testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "college-counselor-route-tests-"));
  callLogPath = path.join(testDataDir, "openrouter-calls.jsonl");
  baseUrl = `http://127.0.0.1:${port}`;

  serverProcess = spawn(process.execPath, ["--import", pathToFileURL(FETCH_MOCK).href, "server.js"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "test",
      DATA_DIR: testDataDir,
      DB_PATH: path.join(testDataDir, "operational.db"),
      ENCRYPTION_KEY: "ab".repeat(32),
      OPENROUTER_API_KEY: "sk-or-test-openrouter-key",
      SCORECARD_API_KEY: "",
      SIM_URL: `http://127.0.0.1:${port + 1}`,
      SIM_INTERNAL_TOKEN: "route-test-sidecar-token",
      TEST_OPENROUTER_CALL_LOG: callLogPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  serverProcess.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
  await waitForHealth();
});

after(async () => {
  if (serverProcess && serverProcess.exitCode == null) {
    serverProcess.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => serverProcess.once("exit", resolve)),
      delay(5_000),
    ]);
  }

  const resolved = testDataDir ? path.resolve(testDataDir) : "";
  const expectedRoot = path.resolve(os.tmpdir()) + path.sep;
  if (resolved.startsWith(expectedRoot) && path.basename(resolved).startsWith("college-counselor-route-tests-")) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

test("chat auto-name persists a generated title and keeps crisis text off the model route", async () => {
  const token = await registerStudent("autoname");

  const crisisThread = await createThread(token);
  const crisisAppend = await appendUserMessage(token, crisisThread, "I want to kill myself");
  assert.equal(crisisAppend.status, 200, JSON.stringify(crisisAppend.data));

  const crisisName = await request("POST", `/api/students/threads/${crisisThread}/autoname`, { token, body: {} });
  assert.equal(crisisName.status, 200, JSON.stringify(crisisName.data));
  assert.equal(crisisName.data.title, "Support resources");
  assert.equal(crisisName.data.crisisSafe, true);

  const persistedCrisis = await request("GET", `/api/students/threads/${crisisThread}`, { token });
  assert.equal(persistedCrisis.status, 200);
  assert.equal(persistedCrisis.data.thread.title, "Support resources");
  assert.equal(loggedModelCalls().length, 0, "crisis auto-name must not call OpenRouter");

  for (const consentType of ["data_processing", "ai_interaction", "cross_border_transfer"]) {
    const consent = await request("POST", "/api/consent/grant", {
      token,
      body: { consentType, grantedBy: "student", locale: "en" },
    });
    assert.equal(consent.status, 200, JSON.stringify(consent.data));
  }

  const ordinaryThread = await createThread(token);
  const ordinaryAppend = await appendUserMessage(token, ordinaryThread, "Help me choose AP classes for next year");
  assert.equal(ordinaryAppend.status, 200, JSON.stringify(ordinaryAppend.data));
  const ordinaryName = await request("POST", `/api/students/threads/${ordinaryThread}/autoname`, { token, body: {} });
  assert.equal(ordinaryName.status, 200, `${JSON.stringify(ordinaryName.data)}\n${serverOutput}`);
  assert.equal(ordinaryName.data.title, "Junior Year Course Plan");

  const persistedOrdinary = await request("GET", `/api/students/threads/${ordinaryThread}`, { token });
  assert.equal(persistedOrdinary.status, 200);
  assert.equal(persistedOrdinary.data.thread.title, "Junior Year Course Plan");
  const calls = loggedModelCalls();
  assert.equal(calls.length, 1);
  assert.match(JSON.stringify(calls[0].messages), /choose AP classes/i);
  assert.doesNotMatch(JSON.stringify(calls), /kill myself/i);
});

test("deadline cascade is tenant-scoped and matches literal school names and complete unit IDs", async () => {
  const firstToken = await registerStudent("deadlines-first");
  const secondToken = await registerStudent("deadlines-second");

  await createDeadline(firstToken, "A_%B — Regular Decision");
  await createDeadline(firstToken, "AxxB — Keep this unrelated deadline");
  await createDeadline(secondToken, "A_%B — Other student's deadline");

  const noAuth = await request("DELETE", "/api/students/deadlines/by-school", {
    body: { schoolName: "A_%B" },
  });
  assert.equal(noAuth.status, 401);

  const literalDelete = await request("DELETE", "/api/students/deadlines/by-school", {
    token: firstToken,
    body: { schoolName: "A_%B" },
  });
  assert.equal(literalDelete.status, 200, JSON.stringify(literalDelete.data));
  assert.equal(literalDelete.data.deleted, 1);
  assert.deepEqual(await listDeadlineTitles(firstToken), ["AxxB — Keep this unrelated deadline"]);
  assert.deepEqual(await listDeadlineTitles(secondToken), ["A_%B — Other student's deadline"]);

  await createDeadline(firstToken, "Exact unit ID", ["166683"]);
  await createDeadline(firstToken, "Containing-but-different unit ID", ["91666839"]);
  await createDeadline(secondToken, "Same unit ID, different student", ["166683"]);

  const partialDelete = await request("DELETE", "/api/students/deadlines/by-school", {
    token: firstToken,
    body: { unitId: "166" },
  });
  assert.equal(partialDelete.status, 200, JSON.stringify(partialDelete.data));
  assert.equal(partialDelete.data.deleted, 0);
  assert.ok((await listDeadlineTitles(firstToken)).includes("Exact unit ID"));

  const exactDelete = await request("DELETE", "/api/students/deadlines/by-school", {
    token: firstToken,
    body: { unitId: "166683" },
  });
  assert.equal(exactDelete.status, 200, JSON.stringify(exactDelete.data));
  assert.equal(exactDelete.data.deleted, 1);

  const firstTitles = await listDeadlineTitles(firstToken);
  assert.ok(!firstTitles.includes("Exact unit ID"));
  assert.ok(firstTitles.includes("Containing-but-different unit ID"));
  assert.ok((await listDeadlineTitles(secondToken)).includes("Same unit ID, different student"));
});
