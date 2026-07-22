import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = path.join(projectRoot, "backend");
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "college-counselor-saas-smoke-"));
const requireBackend = createRequire(path.join(backendDir, "package.json"));
const Database = requireBackend("better-sqlite3");
const { initSaasTenancy } = await import(pathToFileURL(path.join(backendDir, "saas-tenancy.js")).href);

const secret = () => crypto.randomBytes(32).toString("hex");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function port() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}

async function waitReady(url, output) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await delay(250);
  }
  throw new Error(`SaaS did not become ready.\n${output()}`);
}

function cookie(response) {
  const raw = response.headers.getSetCookie?.()[0] || response.headers.get("set-cookie") || "";
  return raw.split(";", 1)[0];
}

async function json(response) {
  return response.json().catch(() => ({}));
}

const appPort = await port();
let simPort = await port();
while (simPort === appPort) simPort = await port();
const encryptionKey = secret();
const emailPepper = secret();
const provisioningToken = secret();
const publicOrigin = "https://saas-smoke.test";
let output = "";
let service;

async function stop() {
  if (!service || service.exitCode !== null) return;
  await new Promise((resolve) => {
    const force = setTimeout(() => service.exitCode === null && service.kill("SIGKILL"), 10_000);
    service.once("exit", () => { clearTimeout(force); resolve(); });
    service.kill("SIGTERM");
  });
}

try {
  service = spawn(process.execPath, ["start-saas.mjs"], {
    cwd: backendDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      WEB_DEPLOYMENT: "1",
      SAAS_DEPLOYMENT: "1",
      HOST: "127.0.0.1",
      PORT: String(appPort),
      SIM_PORT: String(simPort),
      DATA_DIR: dataDir,
      TRUST_PROXY: "1",
      PUBLIC_DOMAIN: "saas-smoke.test",
      PUBLIC_ORIGIN: publicOrigin,
      INVITE_BASE_URL: publicOrigin,
      ENCRYPTION_KEY: encryptionKey,
      SIM_INTERNAL_TOKEN: secret(),
      STUDENT_STORAGE_SALT: secret(),
      SAAS_EMAIL_PEPPER: emailPepper,
      SAAS_PROVISIONING_TOKEN: provisioningToken,
      RESEND_API_KEY: "re_smoke_test_not_used",
      EMAIL_FROM: "Smoke <smoke@saas-smoke.test>",
      RETENTION_MODE: "institutional",
      SAAS_GUARDIAN_CONSENT_REQUIRED: "1",
      SAAS_POLICY_VERSION: "2026.1",
      OPENROUTER_API_KEY: "",
      SCORECARD_API_KEY: "",
      CDS_DAILY_REFRESH: "0",
      AUTO_REFRESH_CDS: "0",
      ENABLE_DOMAIN_MONITOR: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  service.stdout.on("data", (chunk) => { output = (output + chunk).slice(-80_000); });
  service.stderr.on("data", (chunk) => { output = (output + chunk).slice(-80_000); });

  const base = `http://127.0.0.1:${appPort}`;
  await waitReady(`${base}/api/ready`, () => output);
  const runtimeResponse = await fetch(`${base}/api/runtime-config`);
  const runtime = await json(runtimeResponse);
  assert(runtime.deployment === "saas" && runtime.invitationRequired === true, "Runtime did not report invitation-only SaaS mode.");
  assert(runtimeResponse.headers.get("cache-control") === "no-store", "SaaS API responses were cacheable.");
  assert((await fetch(`${base}/organization.html`)).ok, "Organization portal is missing from the SaaS build.");
  assert((await fetch(`${base}/admin.html`)).status === 404, "Desktop administrator page leaked into SaaS.");
  assert((await fetch(`${base}/api/baselines/status`)).status === 404, "Internal baseline metadata leaked in SaaS mode.");
  const anonymousScorecard = await fetch(`${base}/api/colleges/search`, {
    method:"POST",
    headers:{ "Content-Type":"application/json", Origin:publicOrigin },
    body:JSON.stringify({ name:"Example" }),
  });
  assert(anonymousScorecard.status === 401, "Anonymous traffic reached the provider-backed college search route.");

  const openRegistration = await fetch(`${base}/api/students/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: publicOrigin },
    body: JSON.stringify({ email:"student@alpha.test", password:"student password long enough", name:"Alpha Student", grade:11 }),
  });
  assert(openRegistration.status === 403, "SaaS accepted open student registration.");

  async function provision(name, slug, ownerEmail) {
    const response = await fetch(`${base}/api/platform/organizations`, {
      method: "POST",
      headers: { "Content-Type":"application/json", Authorization:`Bearer ${provisioningToken}` },
      body: JSON.stringify({ name, slug, ownerEmail, ownerPassword:"owner password long enough" }),
    });
    assert(response.status === 201, `Organization provisioning failed with ${response.status}.`);
    return json(response);
  }

  const alpha = await provision("Alpha School", "alpha-school", "owner@alpha.test");
  const beta = await provision("Beta School", "beta-school", "owner@beta.test");
  const ownerLogin = await fetch(`${base}/api/organization/auth`, {
    method:"POST",
    headers:{ "Content-Type":"application/json", Origin:publicOrigin },
    body:JSON.stringify({ email:"owner@alpha.test", password:"owner password long enough", organizationSlug:"alpha-school" }),
  });
  assert(ownerLogin.ok, "Owner login failed.");
  const ownerBody = await json(ownerLogin);
  const ownerCookie = cookie(ownerLogin);

  const controlDb = new Database(path.join(dataDir, "counselor.db"));
  const tenancy = initSaasTenancy({ db:controlDb, emailPepper, encryptionKey });
  const studentInvite = tenancy.createInvitation({
    organizationId:alpha.organization.id,
    actorAccountId:alpha.account.id,
    email:"student@alpha.test",
    role:"student",
  });
  controlDb.close();

  const registration = await fetch(`${base}/api/students/register`, {
    method:"POST",
    headers:{ "Content-Type":"application/json", Origin:publicOrigin },
    body:JSON.stringify({
      email:"student@alpha.test",
      password:"student password long enough",
      name:"Alpha Student",
      grade:11,
      invitationToken:studentInvite.token,
    }),
  });
  const registrationBody = await json(registration);
  assert(registration.status === 201, `Invited registration failed with ${registration.status}: ${registrationBody.error || ""}`);
  assert(registrationBody.membershipStatus === "pending_guardian", "Student was not blocked pending guardian consent.");
  const studentCookie = cookie(registration);

  const replay = await fetch(`${base}/api/students/register`, {
    method:"POST",
    headers:{ "Content-Type":"application/json", Origin:publicOrigin },
    body:JSON.stringify({ email:"student@alpha.test", password:"student password long enough", name:"Replay", grade:11, invitationToken:studentInvite.token }),
  });
  assert(replay.status >= 400, "Single-use student invitation was replayable.");
  const blockedBudget = await fetch(`${base}/api/students/budget`, { headers:{ Cookie:studentCookie } });
  assert(blockedBudget.status === 403, "Pending student accessed normal product data.");
  assert(blockedBudget.headers.get("cache-control") === "no-store", "Denied student API data was cacheable.");

  const guardianDb = new Database(path.join(dataDir, "counselor.db"));
  const guardianStore = initSaasTenancy({ db:guardianDb, emailPepper, encryptionKey });
  const guardianInvite = guardianStore.createInvitation({
    organizationId:alpha.organization.id,
    actorAccountId:alpha.account.id,
    email:"guardian@alpha.test",
    role:"guardian",
    targetStudentId:registrationBody.studentId,
  });
  guardianDb.close();

  const guardianAccept = await fetch(`${base}/api/organization/invitations/accept`, {
    method:"POST",
    headers:{ "Content-Type":"application/json", Origin:publicOrigin },
    body:JSON.stringify({ token:guardianInvite.token, email:"guardian@alpha.test", name:"Alpha Guardian", password:"guardian password long enough" }),
  });
  const guardianBody = await json(guardianAccept);
  assert(guardianAccept.ok, `Guardian acceptance failed: ${guardianBody.error || guardianAccept.status}`);
  const guardianCookie = cookie(guardianAccept);
  const guardianRoster = await fetch(`${base}/api/organization/guardian/students`, {
    headers:{ Cookie:guardianCookie },
  });
  const guardianRosterBody = await json(guardianRoster);
  assert(guardianRoster.ok, `Guardian roster failed with ${guardianRoster.status}.`);
  const linkedStudent = guardianRosterBody.students?.find(({ id }) => id === registrationBody.studentId);
  assert(linkedStudent, "Guardian roster did not contain the linked student.");
  assert(
    JSON.stringify(linkedStudent.requiredConsents.map(({ type }) => type).sort())
      === JSON.stringify(["ai_interaction", "cross_border_transfer", "data_processing"]),
    "Guardian roster did not require all production consent categories.",
  );
  for (const descriptor of linkedStudent.requiredConsents) {
    const consent = await fetch(`${base}/api/organization/guardian/consent`, {
      method:"POST",
      headers:{ "Content-Type":"application/json", Origin:publicOrigin, Cookie:guardianCookie, "X-CSRF-Token":guardianBody.csrfToken },
      body:JSON.stringify({
        studentId:registrationBody.studentId,
        consentType:descriptor.type,
        policyVersion:guardianRosterBody.policyVersion,
        scope:descriptor.scope,
        granted:true,
      }),
    });
    assert(consent.ok, `Guardian ${descriptor.type} consent failed with ${consent.status}.`);
  }
  assert((await fetch(`${base}/api/students/budget`, { headers:{ Cookie:studentCookie } })).ok, "Guardian-approved student remained blocked.");

  const csrfDenied = await fetch(`${base}/api/organization/members/${encodeURIComponent(beta.membership.id)}/status`, {
    method:"PATCH",
    headers:{ "Content-Type":"application/json", Origin:publicOrigin, Cookie:ownerCookie },
    body:JSON.stringify({ status:"suspended" }),
  });
  assert(csrfDenied.status === 401, "Manager mutation succeeded without CSRF proof.");
  const crossTenant = await fetch(`${base}/api/organization/members/${encodeURIComponent(beta.membership.id)}/status`, {
    method:"PATCH",
    headers:{ "Content-Type":"application/json", Origin:publicOrigin, Cookie:ownerCookie, "X-CSRF-Token":ownerBody.csrfToken },
    body:JSON.stringify({ status:"suspended" }),
  });
  assert(crossTenant.status === 404, `Cross-tenant membership mutation returned ${crossTenant.status}, expected 404.`);

  console.log("Multi-tenant SaaS production smoke test passed.");
} catch (error) {
  console.error(error.message);
  if (output) console.error(output);
  process.exitCode = 1;
} finally {
  await stop();
  await fs.rm(dataDir, { recursive:true, force:true });
}
