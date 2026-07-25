import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const backendDir = path.join(projectRoot, "backend");
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "college-counselor-web-smoke-"));

function randomSecret() {
  return crypto.randomBytes(32).toString("hex");
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForReady(url, output) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}.\n${output()}`);
}

const port = await availablePort();
let simulationPort = await availablePort();
while (simulationPort === port) simulationPort = await availablePort();
const encryptionKey = randomSecret();
const simulationToken = randomSecret();
const storageSalt = randomSecret();
const registrationAccessCode = randomSecret();
const publicOrigin = "https://web-smoke.test";
let output = "";
let service;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function stopService() {
  if (!service || service.exitCode !== null) return;
  await new Promise((resolve) => {
    const force = setTimeout(() => {
      if (service.exitCode === null) service.kill("SIGKILL");
    }, 10_000);
    force.unref();
    service.once("exit", () => {
      clearTimeout(force);
      resolve();
    });
    service.kill("SIGTERM");
  });
}

try {
  service = spawn(process.execPath, ["start-web.mjs"], {
    cwd: backendDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      WEB_DEPLOYMENT: "1",
      HOST: "127.0.0.1",
      PORT: String(port),
      SIM_PORT: String(simulationPort),
      SIM_URL: `http://127.0.0.1:${simulationPort}`,
      DATA_DIR: dataDir,
      TRUST_PROXY: "1",
      PUBLIC_DOMAIN: "web-smoke.test",
      PUBLIC_ORIGIN: publicOrigin,
      ENCRYPTION_KEY: encryptionKey,
      SIM_INTERNAL_TOKEN: simulationToken,
      STUDENT_STORAGE_SALT: storageSalt,
      REGISTRATION_ACCESS_CODE: registrationAccessCode,
      OPENROUTER_API_KEY: "",
      SCORECARD_API_KEY: "",
      CDS_DAILY_REFRESH: "0",
      AUTO_REFRESH_CDS: "0",
      ENABLE_DOMAIN_MONITOR: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  service.stdout.on("data", (chunk) => {
    output = (output + chunk.toString()).slice(-50_000);
  });
  service.stderr.on("data", (chunk) => {
    output = (output + chunk.toString()).slice(-50_000);
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForReady(`${baseUrl}/api/ready`, () => output);

  const home = await fetch(`${baseUrl}/`);
  assert(home.ok, `Expected the built frontend at /, received ${home.status}.`);
  assert((home.headers.get("content-type") || "").includes("text/html"), "Root did not return HTML.");

  const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
  assert(health.status === "ok", "Liveness response was not healthy.");
  assert(!Object.hasOwn(health, "crisisLast24h"), "Liveness response exposed private metrics.");

  const runtime = await fetch(`${baseUrl}/api/runtime-config`).then((response) => response.json());
  assert(runtime.deployment === "web", "Runtime config did not report web deployment.");
  assert(runtime.registrationAccessCodeRequired === true, "Runtime config did not require an access code.");

  const registrationBody = {
    email: `smoke-${crypto.randomUUID()}@example.test`,
    password: "a long production smoke passphrase",
    name: "Web Smoke",
    grade: 11,
    schoolDomain: "example.test",
  };
  const deniedRegistration = await fetch(`${baseUrl}/api/students/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: publicOrigin },
    body: JSON.stringify(registrationBody),
  });
  assert(deniedRegistration.status === 403, "Registration succeeded without its access code.");

  const allowedRegistration = await fetch(`${baseUrl}/api/students/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: publicOrigin },
    body: JSON.stringify({ ...registrationBody, registrationAccessCode }),
  });
  assert(allowedRegistration.status === 201, `Registration smoke failed with ${allowedRegistration.status}.`);

  const remoteAdmin = await fetch(`${baseUrl}/api/admin/status`, {
    headers: {
      Origin: publicOrigin,
      "X-Forwarded-For": "203.0.113.10",
      "X-Forwarded-Proto": "https",
    },
  });
  assert(remoteAdmin.status === 404, "The desktop administrator API was exposed by the web profile.");

  const adminPage = await fetch(`${baseUrl}/admin.html`);
  assert(adminPage.status === 404, "The desktop administrator page was served by the web build.");

  console.log("Private web production smoke test passed.");
} catch (error) {
  console.error(error.message);
  if (output) console.error(output);
  process.exitCode = 1;
} finally {
  await stopService();
  await fs.rm(dataDir, { recursive: true, force: true });
}
