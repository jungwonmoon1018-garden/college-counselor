import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_PATH = path.join(BACKEND_DIR, "server.js");
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(BACKEND_DIR, "package.json"), "utf8"));
const SERVER_SOURCE = fs.readFileSync(SERVER_PATH, "utf8");
const SIDECAR_SOURCE = fs.readFileSync(path.join(BACKEND_DIR, "simulation-sidecar.js"), "utf8");
const SUPERVISOR_SOURCE = fs.readFileSync(path.join(BACKEND_DIR, "start-web.mjs"), "utf8");
const TEST_ENCRYPTION_KEY = "075466d20db8ae73599bf7a84fde8df9c6a52d3bd210da162ad2c729d80a684d";

const VALID_WEB_ENV = Object.freeze({
  NODE_ENV: "production",
  WEB_DEPLOYMENT: "1",
  HOST: "127.0.0.1",
  PORT: "31991",
  TRUST_PROXY: "1",
  PUBLIC_ORIGIN: "https://counselor.school.test",
  PUBLIC_DOMAIN: "counselor.school.test",
  ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
  SIM_INTERNAL_TOKEN: "Simulation-Token-0123456789-ABCDEFGH",
  STUDENT_STORAGE_SALT: "Student-Storage-Salt-0123456789-ABCDEFGH",
  REGISTRATION_ACCESS_CODE: "Registration-Code-0123456789-ABCDEFGH",
  OPENROUTER_API_KEY: "",
  SCORECARD_API_KEY: "",
  CDS_DAILY_REFRESH: "0",
  AUTO_REFRESH_CDS: "0",
});

const VALID_SAAS_ENV = Object.freeze({
  ...VALID_WEB_ENV,
  SAAS_DEPLOYMENT: "1",
  INVITE_BASE_URL: VALID_WEB_ENV.PUBLIC_ORIGIN,
  SAAS_EMAIL_PEPPER: "SaaS-Email-Pepper-0123456789-ABCDEFGH",
  SAAS_PROVISIONING_TOKEN: "SaaS-Provisioning-Token-0123456789-ABCDEFGH",
  RESEND_API_KEY: "re_saas_boot_validation_test",
  EMAIL_FROM: "College Counselor <no-reply@counselor.school.test>",
  SAAS_GUARDIAN_CONSENT_REQUIRED: "1",
  SAAS_POLICY_VERSION: "2026.1",
  SAAS_SESSION_IDLE_MINUTES: "15",
  RETENTION_MODE: "institutional",
});

function invalidWebBoot(overrides) {
  return spawnSync(process.execPath, [SERVER_PATH], {
    cwd: BACKEND_DIR,
    env: { ...process.env, ...VALID_WEB_ENV, ...overrides },
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
}

function invalidSaasBoot(overrides) {
  const env = { ...process.env, ...VALID_SAAS_ENV, ...overrides };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key];
  }
  return spawnSync(process.execPath, [SERVER_PATH], {
    cwd: BACKEND_DIR,
    env,
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForHealth(baseUrl, child, output) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode})\n${output()}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become healthy\n${output()}`);
}

function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const force = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(force);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

describe("production web configuration validation", () => {
  for (const [name, overrides, expected] of [
    ["invalid PORT", { PORT: "3001junk" }, /PORT must be an integer/],
    ["non-exact proxy trust", { TRUST_PROXY: "0" }, /TRUST_PROXY must be exactly 1/],
    ["low-entropy encryption key", { ENCRYPTION_KEY: "0".repeat(64) }, /high entropy/],
    ["repeated encryption pattern", { ENCRYPTION_KEY: "01234567".repeat(8) }, /high entropy/],
    ["placeholder secret", { SIM_INTERNAL_TOKEN: "REPLACE_WITH_SIMULATION_TOKEN_0123456789" }, /SIM_INTERNAL_TOKEN/],
    ["repeated sidecar secret", { SIM_INTERNAL_TOKEN: "ABCDEFGH".repeat(4) }, /SIM_INTERNAL_TOKEN/],
    ["placeholder public host", { PUBLIC_ORIGIN: "https://app.example.com", PUBLIC_DOMAIN: "app.example.com" }, /placeholder hostname/],
    ["mismatched public domain", { PUBLIC_DOMAIN: "other.school.test" }, /PUBLIC_DOMAIN/],
    ["insecure extra origin", { ALLOWED_ORIGINS: "http://other.school.test" }, /exact HTTPS origin/],
    ["different HTTPS origin", { ALLOWED_ORIGINS: "https://other.school.test" }, /must match PUBLIC_ORIGIN/],
  ]) {
    test(`rejects ${name}`, () => {
      const result = invalidWebBoot(overrides);
      assert.notEqual(result.status, 0);
      assert.match(`${result.stdout}\n${result.stderr}`, expected);
    });
  }
});

describe("production SaaS configuration validation", () => {
  for (const [name, overrides, expected] of [
    ["too-short minute lifetime", { SAAS_SESSION_IDLE_MINUTES: "4" }, /SAAS_SESSION_IDLE_MINUTES must be an integer from 5 through 120/],
    ["too-long minute lifetime", { SAAS_SESSION_IDLE_MINUTES: "121" }, /SAAS_SESSION_IDLE_MINUTES must be an integer from 5 through 120/],
    ["non-integer minute lifetime", { SAAS_SESSION_IDLE_MINUTES: "15minutes" }, /SAAS_SESSION_IDLE_MINUTES must be an integer from 5 through 120/],
    ["unsafe deprecated hour lifetime", {
      SAAS_SESSION_IDLE_MINUTES: undefined,
      SAAS_SESSION_IDLE_HOURS: "8",
    }, /SAAS_SESSION_IDLE_HOURS is deprecated and must be 1 or 2/],
    ["undersized student upload quota", {
      SAAS_STUDENT_UPLOAD_QUOTA_MB: "24",
    }, /SAAS_STUDENT_UPLOAD_QUOTA_MB must be an integer from 25 through 1024/],
    ["malformed tenant upload quota", {
      SAAS_TENANT_UPLOAD_QUOTA_MB: "2048mb",
    }, /SAAS_TENANT_UPLOAD_QUOTA_MB must be an integer from 100 through 102400/],
    ["undersized free-storage reserve", {
      SAAS_MIN_FREE_STORAGE_MB: "63",
    }, /SAAS_MIN_FREE_STORAGE_MB must be an integer from 64 through 102400/],
    ["tenant quota below student quota", {
      SAAS_STUDENT_UPLOAD_QUOTA_MB: "200",
      SAAS_TENANT_UPLOAD_QUOTA_MB: "100",
    }, /SAAS_TENANT_UPLOAD_QUOTA_MB must be at least SAAS_STUDENT_UPLOAD_QUOTA_MB/],
  ]) {
    test(`rejects ${name}`, () => {
      const result = invalidSaasBoot(overrides);
      assert.notEqual(result.status, 0);
      assert.match(`${result.stdout}\n${result.stderr}`, expected);
    });
  }
});

describe("private web runtime boundary", () => {
  let child;
  let baseUrl;
  let dataDir;
  let output = "";
  const registrationAccessCode = "Registration-Code-0123456789-ABCDEFGH";
  const publicOrigin = "https://counselor.school.test";

  before(async () => {
    const port = await unusedPort();
    const unusedSimPort = await unusedPort();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-web-deployment-test-"));
    child = spawn(process.execPath, [SERVER_PATH], {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        NODE_ENV: "test",
        WEB_DEPLOYMENT: "1",
        HOST: "127.0.0.1",
        PORT: String(port),
        TRUST_PROXY: "1",
        PUBLIC_ORIGIN: publicOrigin,
        PUBLIC_DOMAIN: "counselor.school.test",
        ALLOWED_ORIGINS: "",
        DATA_DIR: dataDir,
        ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
        SIM_INTERNAL_TOKEN: "Simulation-Token-0123456789-ABCDEFGH",
        SIM_URL: `http://127.0.0.1:${unusedSimPort}`,
        SIM_TIMEOUT_MS: "100",
        STUDENT_STORAGE_SALT: "Student-Storage-Salt-0123456789-ABCDEFGH",
        REGISTRATION_ACCESS_CODE: registrationAccessCode,
        OPENROUTER_API_KEY: "",
        SCORECARD_API_KEY: "",
        CDS_DAILY_REFRESH: "0",
        AUTO_REFRESH_CDS: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child, () => output);
  });

  after(async () => {
    await stopChild(child);
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test("publishes only the safe runtime flags", async () => {
    const response = await fetch(`${baseUrl}/api/runtime-config`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      deployment: "web",
      registrationAccessCodeRequired: true,
    });
  });

  test("keeps health minimal and reports dependency readiness separately", async () => {
    const health = await fetch(`${baseUrl}/api/health`);
    assert.deepEqual(await health.json(), { status: "ok" });
    const ready = await fetch(`${baseUrl}/api/ready`);
    assert.equal(ready.status, 503);
    assert.deepEqual(await ready.json(), {
      status: "not_ready",
      checks: { operational: true, pii: true, vectors: true, simulation: false },
    });
  });

  test("accepts origin-less requests, allowlists the public origin, and rejects others", async () => {
    const allowed = await fetch(`${baseUrl}/api/runtime-config`, { headers: { Origin: publicOrigin } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), publicOrigin);
    const denied = await fetch(`${baseUrl}/api/runtime-config`, { headers: { Origin: "https://attacker.test" } });
    assert.equal(denied.status, 403);
  });

  test("requires the access code in the registration body", async () => {
    const payload = {
      email: `web-${Date.now()}@example.test`,
      password: "Correct-Horse-Battery-9!",
      grade: 11,
      name: "Web Test Student",
    };
    const denied = await fetch(`${baseUrl}/api/students/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(denied.status, 403);
    const allowed = await fetch(`${baseUrl}/api/students/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, registrationAccessCode }),
    });
    assert.equal(allowed.status, 201, await allowed.text());
  });

  test("hard-disables desktop administrator APIs even for spoofed loopback input", async () => {
    const response = await fetch(`${baseUrl}/api/admin/status`, {
      headers: { "X-Forwarded-For": "127.0.0.1" },
    });
    assert.equal(response.status, 404);
  });

  test("does not serve web admin SPA entry points", async () => {
    assert.equal((await fetch(`${baseUrl}/admin`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/admin.html`, { method: "HEAD" })).status, 404);
  });
});

test("web supervisor owns both services and is exposed by npm", () => {
  assert.equal(PACKAGE_JSON.scripts["start:web"], "node start-web.mjs");
  assert.match(SUPERVISOR_SOURCE, /simulation-sidecar\.js/);
  assert.match(SUPERVISOR_SOURCE, /server\.js/);
  assert.match(SUPERVISOR_SOURCE, /waitForSidecar/);
  assert.match(SUPERVISOR_SOURCE, /SIGTERM/);
  const sidecarEnvSource = SUPERVISOR_SOURCE.match(/const sidecarEnv = \{\};[\s\S]*?const children = new Map\(\);/)?.[0] || "";
  assert.match(sidecarEnvSource, /SIM_INTERNAL_TOKEN/);
  assert.doesNotMatch(sidecarEnvSource, /ENCRYPTION_KEY|OPENROUTER_API_KEY|REGISTRATION_ACCESS_CODE|STUDENT_STORAGE_SALT/);
  assert.match(SUPERVISOR_SOURCE, /process\.exit\(forced \? 1 : exitCode\)/);
  assert.match(SIDECAR_SOURCE, /hasRepeatedPattern/);
  assert.match(SERVER_SOURCE, /piiVault\.db/);
  assert.match(SERVER_SOURCE, /vectorStore\.db/);
  assert.doesNotMatch(SERVER_SOURCE, /piiVault\.close\(\)/);
  assert.doesNotMatch(SERVER_SOURCE, /vectorStore\.close\(\)/);
  assert.doesNotMatch(SIDECAR_SOURCE.match(/app\.get\("\/health"[\s\S]*?\n\}\);/)?.[0] || "", /cleanupExpiredSimulations/);
});
