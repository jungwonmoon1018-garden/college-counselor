import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendDir = path.dirname(fileURLToPath(import.meta.url));

function parsePort(rawValue, name) {
  const raw = String(rawValue).trim();
  if (!/^(0|[1-9]\d*)$/.test(raw)) throw new Error(`${name} must be an integer from 1 through 65535.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be an integer from 1 through 65535.`);
  }
  return value;
}

function parseTimeout(rawValue, fallback) {
  const value = Number(rawValue || fallback);
  return Number.isSafeInteger(value) && value >= 1_000 && value <= 120_000 ? value : fallback;
}

const simPort = parsePort(process.env.SIM_PORT || "3002", "SIM_PORT");
const mainPort = parsePort(process.env.PORT || "3001", "PORT");
const startupTimeoutMs = parseTimeout(process.env.WEB_STARTUP_TIMEOUT_MS, 30_000);
const shutdownTimeoutMs = parseTimeout(process.env.WEB_SHUTDOWN_TIMEOUT_MS, 12_000);
const mainEnv = {
  ...process.env,
  NODE_ENV: "production",
  WEB_DEPLOYMENT: "1",
  PORT: String(mainPort),
  SIM_PORT: String(simPort),
  SIM_URL: `http://127.0.0.1:${simPort}`,
};

// The sidecar handles disposable simulation state and does not need provider,
// encryption, registration, or student-storage secrets. Preserve only the
// platform variables Node/native modules need plus explicit sidecar settings.
const sidecarEnv = {};
for (const key of [
  "PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "ComSpec", "WINDIR",
  "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA",
  "TZ", "LANG", "LC_ALL",
]) {
  if (process.env[key] !== undefined) sidecarEnv[key] = process.env[key];
}
Object.assign(sidecarEnv, {
  NODE_ENV: "production",
  WEB_DEPLOYMENT: "1",
  SIM_PORT: String(simPort),
  SIM_INTERNAL_TOKEN: String(process.env.SIM_INTERNAL_TOKEN || ""),
});
for (const key of ["DATA_DIR", "SIM_DATA_DIR", "SIM_TTL_DAYS", "SIM_PROFILE_DB_PATH", "SIM_VECTOR_DB_PATH"]) {
  if (process.env[key] !== undefined) sidecarEnv[key] = process.env[key];
}

const children = new Map();
let stopping = false;
let stopPromise = null;

function spawnService(name, script, env) {
  const child = spawn(process.execPath, [path.join(backendDir, script)], {
    cwd: backendDir,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  children.set(name, child);
  child.once("error", (error) => {
    console.error(`[WEB] ${name} failed to start: ${error.message}`);
    if (!stopping) void stopAll(1, `${name} failed to start`);
  });
  child.once("exit", (code, signal) => {
    console.log(`[WEB] ${name} exited (${signal ?? code ?? "unknown"}).`);
    if (!stopping) void stopAll(code && code > 0 ? code : 1, `${name} exited unexpectedly`);
  });
  return child;
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("close", resolve));
}

async function stopAll(exitCode, reason, signal = "SIGTERM") {
  if (stopPromise) return stopPromise;
  stopping = true;
  stopPromise = (async () => {
    console.log(`[WEB] Stopping services: ${reason}.`);
    const liveChildren = Array.from(children.values())
      .filter((child) => child.exitCode === null && child.signalCode === null);
    for (const child of liveChildren) {
      try { child.kill(signal); }
      catch (error) { console.error(`[WEB] Failed to signal child ${child.pid}: ${error.message}`); }
    }

    let forced = false;
    await Promise.race([
      Promise.all(liveChildren.map(waitForExit)),
      new Promise((resolve) => setTimeout(() => { forced = true; resolve(); }, shutdownTimeoutMs)),
    ]);
    if (forced) {
      console.error(`[WEB] Graceful shutdown exceeded ${shutdownTimeoutMs}ms; forcing child termination.`);
      for (const child of liveChildren) {
        if (child.exitCode === null && child.signalCode === null) {
          try { child.kill("SIGKILL"); } catch {}
        }
      }
    }
    process.exit(forced ? 1 : exitCode);
  })();
  return stopPromise;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSidecar(child) {
  const healthUrl = `http://127.0.0.1:${simPort}/health`;
  const deadline = Date.now() + startupTimeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (stopping) throw new Error("Startup was interrupted.");
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Simulation sidecar exited before becoming healthy (${child.signalCode || child.exitCode}).`);
    }
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_000) });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.status === "ok") return;
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(`Simulation sidecar did not become healthy within ${startupTimeoutMs}ms${lastError ? `: ${lastError.message}` : ""}.`);
}

process.once("SIGINT", () => { void stopAll(0, "SIGINT received", "SIGINT"); });
process.once("SIGTERM", () => { void stopAll(0, "SIGTERM received", "SIGTERM"); });

try {
  console.log("[WEB] Starting simulation sidecar...");
  const sidecar = spawnService("simulation-sidecar", "simulation-sidecar.js", sidecarEnv);
  await waitForSidecar(sidecar);
  if (stopping) await stopPromise;
  console.log("[WEB] Simulation sidecar is ready; starting main server...");
  spawnService("main-server", "server.js", mainEnv);
} catch (error) {
  console.error(`[WEB] Startup failed: ${error.message}`);
  await stopAll(1, "startup failed");
}
