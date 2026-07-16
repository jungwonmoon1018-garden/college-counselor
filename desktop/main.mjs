import { app, BrowserWindow, ipcMain, safeStorage, shell } from "electron";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ALLOWED_SECRET_NAMES = new Set(["openrouter", "scorecard"]);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

let backendProcess = null;
let simulationProcess = null;
let localServer = null;
let backendPort = null;
let simulationPort = null;
let appPort = null;
let appOrigin = null;
let shuttingDown = false;
let desktopBootstrapToken = "";
let simulationToken = "";

function resourcePath(name) {
  return app.isPackaged ? join(process.resourcesPath, name) : resolve(__dirname, "..", name);
}

function frontendPath() {
  return app.isPackaged
    ? join(process.resourcesPath, "frontend")
    : resolve(__dirname, "..", "frontend", "dist");
}

function secretDirectory() {
  const path = join(app.getPath("userData"), "secure-config");
  mkdirSync(path, { recursive: true, mode: 0o700 });
  return path;
}

function secretPath(name) {
  return join(secretDirectory(), name + ".bin");
}

function childProcessBaseEnvironment() {
  const allowed = [
    "PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME",
    "USERPROFILE", "APPDATA", "LOCALAPPDATA", "LANG", "LC_ALL",
  ];
  return Object.fromEntries(
    allowed.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]),
  );
}

function requireSafeStorage() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("The operating system credential store is unavailable. Secrets were not saved.");
  }
}

function readSecret(name) {
  const path = secretPath(name);
  if (!existsSync(path)) return "";
  requireSafeStorage();
  return safeStorage.decryptString(Buffer.from(readFileSync(path, "utf8"), "base64"));
}

function writeSecret(name, value) {
  requireSafeStorage();
  const encrypted = safeStorage.encryptString(String(value));
  writeFileSync(secretPath(name), encrypted.toString("base64"), { encoding: "utf8", mode: 0o600 });
}

function ensureEncryptionKey() {
  const existing = readSecret("encryption");
  if (existing) return existing;
  const generated = crypto.randomBytes(32).toString("hex");
  writeSecret("encryption", generated);
  return generated;
}

async function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

function backendEnvironment() {
  const dataDir = join(app.getPath("userData"), "data");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  return {
    ...childProcessBaseEnvironment(),
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(backendPort),
    DATA_DIR: dataDir,
    DESKTOP_ORIGIN: appOrigin,
    ALLOWED_ORIGINS: appOrigin,
    DESKTOP_BOOTSTRAP_TOKEN: desktopBootstrapToken,
    ENCRYPTION_KEY: ensureEncryptionKey(),
    OPENROUTER_API_KEY: readSecret("openrouter"),
    SCORECARD_API_KEY: readSecret("scorecard"),
    SIM_PORT: String(simulationPort),
    SIM_URL: "http://127.0.0.1:" + simulationPort,
    SIM_INTERNAL_TOKEN: simulationToken,
    ELECTRON_RUN_AS_NODE: "1",
  };
}

function simulationEnvironment() {
  const dataDir = join(app.getPath("userData"), "data");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  return {
    ...childProcessBaseEnvironment(),
    NODE_ENV: "production",
    DATA_DIR: dataDir,
    SIM_PORT: String(simulationPort),
    SIM_INTERNAL_TOKEN: simulationToken,
    ELECTRON_RUN_AS_NODE: "1",
  };
}

async function startSimulation() {
  const sidecarFile = join(resourcePath("backend"), "simulation-sidecar.js");
  const executable = app.isPackaged ? process.execPath : (process.env.CC_NODE_BINARY || "node");
  simulationProcess = spawn(executable, [sidecarFile], {
    cwd:resourcePath("backend"), env:simulationEnvironment(), windowsHide:true, stdio:["ignore","pipe","pipe"],
  });
  simulationProcess.stdout.on("data", (chunk) => process.stdout.write("[simulation] " + chunk));
  simulationProcess.stderr.on("data", (chunk) => process.stderr.write("[simulation] " + chunk));
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (simulationProcess && simulationProcess.exitCode != null) throw new Error("The simulation sidecar exited during startup.");
    try { const response = await fetch("http://127.0.0.1:" + simulationPort + "/health"); if (response.ok) return; } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error("The simulation sidecar did not become ready in time.");
}

async function waitForBackend(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (backendProcess && backendProcess.exitCode != null) {
      throw new Error("The bundled backend exited during startup.");
    }
    try {
      const response = await fetch("http://127.0.0.1:" + backendPort + "/api/health");
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error("The bundled backend did not become ready in time.");
}

async function startBackend() {
  desktopBootstrapToken = crypto.randomBytes(32).toString("hex");
  const serverFile = join(resourcePath("backend"), "server.js");
  if (!existsSync(serverFile)) throw new Error("Bundled backend is missing: " + serverFile);
  const executable = app.isPackaged ? process.execPath : (process.env.CC_NODE_BINARY || "node");
  backendProcess = spawn(executable, [serverFile], {
    cwd: resourcePath("backend"),
    env: backendEnvironment(),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  backendProcess.stdout.on("data", (chunk) => process.stdout.write("[backend] " + chunk));
  backendProcess.stderr.on("data", (chunk) => process.stderr.write("[backend] " + chunk));
  await waitForBackend();
}

async function stopBackend() {
  const child = backendProcess;
  backendProcess = null;
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 5000)),
  ]);
  if (child.exitCode == null) child.kill("SIGKILL");
}

async function stopSimulation() {
  const child = simulationProcess;
  simulationProcess = null;
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolveExit) => child.once("exit", resolveExit)), new Promise((resolveWait) => setTimeout(resolveWait, 5000))]);
  if (child.exitCode == null) child.kill("SIGKILL");
}

async function restartBackend() {
  await stopBackend();
  await startBackend();
}

function securityHeaders(res) {
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function proxyApi(req, res) {
  const upstream = httpRequest({
    hostname: "127.0.0.1",
    port: backendPort,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: "127.0.0.1:" + backendPort },
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "The local counselor service is restarting." }));
  });
  req.pipe(upstream);
}

function serveFrontend(req, res) {
  securityHeaders(res);
  if (req.url && req.url.startsWith("/api/")) return proxyApi(req, res);
  const root = frontendPath();
  let rawPath;
  try {
    rawPath = decodeURIComponent(new URL(req.url || "/", appOrigin).pathname);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Invalid request path");
    return;
  }
  const requested = rawPath === "/" ? "index.html" : rawPath.replace(/^\/+/, "");
  let path = resolve(root, normalize(requested));
  if (path !== root && !path.startsWith(root + sep)) {
    res.writeHead(400);
    res.end("Invalid path");
    return;
  }
  if (!existsSync(path) || extname(path) === "") path = join(root, "index.html");
  if (!existsSync(path)) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Frontend bundle is missing. Run the frontend build first.");
    return;
  }
  const headers = {
    "Content-Type": MIME[extname(path).toLowerCase()] || "application/octet-stream",
    "Cache-Control": extname(path) === ".html" ? "no-store" : "public, max-age=31536000, immutable",
  };
  res.writeHead(200, headers);
  createReadStream(path).pipe(res);
}

async function startLocalServer() {
  localServer = createServer(serveFrontend);
  await new Promise((resolveListen, reject) => {
    localServer.once("error", reject);
    localServer.listen(appPort, "127.0.0.1", resolveListen);
  });
}

function assertAdminRenderer(event) {
  const sender = new URL(event.senderFrame.url);
  if (sender.origin !== appOrigin || sender.pathname !== "/admin.html") {
    throw new Error("Admin secret access is only available from the local admin screen.");
  }
}

async function adminFetch(event, path, options = {}) {
  return event.sender.session.fetch(appOrigin + path, {
    credentials: "include",
    ...options,
    headers: { Origin: appOrigin, ...(options.headers || {}) },
  });
}

async function captureAdminCookie(event, response) {
  const header = response.headers.get("set-cookie") || "";
  const match = header.match(/(?:^|,\s*)cc_admin_session=([^;]+)/i);
  if (!match) return;
  await event.sender.session.cookies.set({
    url:appOrigin + "/api/admin",
    name:"cc_admin_session",
    value:match[1],
    path:"/api/admin",
    httpOnly:true,
    secure:false,
    sameSite:"strict",
    expirationDate:Date.now() / 1000 + 3600,
  });
}

async function validateAdminSession(event) {
  const response = await adminFetch(event, "/api/admin/session");
  if (!response.ok) throw new Error("Administrator session expired.");
  return response.json();
}

async function authorizeAdminMutation(event, csrfToken) {
  await validateAdminSession(event);
  const response = await adminFetch(event, "/api/admin/authorize", {
    method: "POST",
    headers: { "X-CSRF-Token": String(csrfToken || "") },
  });
  if (!response.ok) throw new Error("Administrator session expired.");
}

function registerIpc() {
  ipcMain.handle("admin-auth:bootstrap", async (event, { password } = {}) => {
    assertAdminRenderer(event);
    const response = await adminFetch(event, "/api/admin/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Desktop-Bootstrap": desktopBootstrapToken },
      body: JSON.stringify({ password }),
    });
    await captureAdminCookie(event, response);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Administrator setup failed.");
    return body;
  });
  ipcMain.handle("admin-auth:recover", async (event, { recoveryCode, newPassword } = {}) => {
    assertAdminRenderer(event);
    const response = await adminFetch(event, "/api/admin/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Desktop-Bootstrap": desktopBootstrapToken },
      body: JSON.stringify({ recoveryCode, newPassword }),
    });
    await captureAdminCookie(event, response);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Administrator recovery failed.");
    return body;
  });
  ipcMain.handle("admin-secrets:status", async (event) => {
    assertAdminRenderer(event);
    await validateAdminSession(event);
    const response = await adminFetch(event, "/api/admin/secrets/status");
    if (!response.ok) throw new Error("Could not load secret status.");
    const status = await response.json();
    const secrets = status.secrets || status;
    return {
      secrets: {
        ...secrets,
        encryption: { configured: Boolean(readSecret("encryption")), mutable: false },
      },
    };
  });
  ipcMain.handle("admin-secrets:set", async (event, { name, value, csrfToken } = {}) => {
    assertAdminRenderer(event);
    await validateAdminSession(event);
    if (!ALLOWED_SECRET_NAMES.has(name)) throw new Error("This secret cannot be changed.");
    const normalized = String(value || "").trim();
    if (!normalized || normalized.length > 4096) throw new Error("Enter a valid secret value.");
    const validation = await adminFetch(event, "/api/admin/secrets/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": String(csrfToken || "") },
      body: JSON.stringify({ kind: name, value: normalized }),
    });
    const validationBody = await validation.json().catch(() => ({}));
    if (!validation.ok) throw new Error(validationBody.error || "The provider rejected this secret.");
    writeSecret(name, normalized);
    await restartBackend();
    return { configured: true, restarted: true };
  });
  ipcMain.handle("admin-secrets:clear", async (event, { name, csrfToken } = {}) => {
    assertAdminRenderer(event);
    await authorizeAdminMutation(event, csrfToken);
    if (!ALLOWED_SECRET_NAMES.has(name)) throw new Error("This secret cannot be changed.");
    writeSecret(name, "");
    await restartBackend();
    return { configured: false, restarted: true };
  });
  ipcMain.handle("runtime:restart", async (event, { csrfToken } = {}) => {
    assertAdminRenderer(event);
    await authorizeAdminMutation(event, csrfToken);
    await restartBackend();
    return { restarted: true };
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 600,
    show: false,
    backgroundColor: "#0a0e17",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !url.startsWith(appOrigin)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const target = new URL(url);
    if (target.origin === appOrigin) return;
    event.preventDefault();
    if (/^https?:$/i.test(target.protocol)) void shell.openExternal(url);
  });
  window.once("ready-to-show", () => window.show());
  void window.loadURL(appOrigin + "/index.html");
}

async function boot() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  backendPort = await reservePort();
  simulationPort = await reservePort();
  appPort = await reservePort();
  appOrigin = "http://127.0.0.1:" + appPort;
  simulationToken = crypto.randomBytes(32).toString("hex");
  await startSimulation();
  await startBackend();
  await startLocalServer();
  registerIpc();
  if (process.env.CC_DESKTOP_SMOKE === "1") {
    shuttingDown = true;
    await stopBackend();
    await stopSimulation();
    await new Promise((resolveClose) => localServer.close(resolveClose));
    app.quit();
    return;
  }
  createWindow();
}

app.on("second-instance", () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (shuttingDown) return;
  event.preventDefault();
  shuttingDown = true;
  Promise.all([
    stopBackend(),
    stopSimulation(),
    localServer ? new Promise((resolveClose) => localServer.close(resolveClose)) : Promise.resolve(),
  ]).finally(() => app.quit());
});

app.whenReady().then(boot).catch((error) => {
  console.error("[desktop] startup failed", error);
  Promise.all([stopBackend(), stopSimulation()]).finally(() => app.exit(1));
});
