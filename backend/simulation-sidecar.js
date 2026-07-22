import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  initSimulationStore,
  closeSimulationStore,
  createSimulation,
  getSimulation,
  deleteSimulation,
  exportStudentSimulations,
  deleteAllStudentSimulations,
} from "./simulation-engine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SIM_PORT_RAW = String(process.env.SIM_PORT || "3002").trim();
const SIM_PORT = /^(0|[1-9]\d*)$/.test(SIM_PORT_RAW) ? Number(SIM_PORT_RAW) : NaN;
const DATA_DIR = process.env.SIM_DATA_DIR || process.env.DATA_DIR || path.join(__dirname, "data");
const SIM_TTL_DAYS = parseInt(process.env.SIM_TTL_DAYS || "7", 10);
const SIM_INTERNAL_TOKEN = process.env.SIM_INTERNAL_TOKEN || "local-simulation-sidecar";
const WEB_DEPLOYMENT = process.env.WEB_DEPLOYMENT === "1";

function hasRepeatedPattern(value, maxPatternLength = 16) {
  const secret = String(value || "");
  const largestPattern = Math.min(maxPatternLength, Math.floor(secret.length / 2));
  for (let length = 1; length <= largestPattern; length += 1) {
    if (secret.length % length !== 0) continue;
    const pattern = secret.slice(0, length);
    if (pattern.repeat(secret.length / length) === secret) return true;
  }
  return false;
}

function isStrongSecret(value) {
  const secret = String(value || "");
  return Buffer.byteLength(secret, "utf8") >= 32
    && Buffer.byteLength(secret, "utf8") <= 512
    && new Set(secret).size >= 8
    && !hasRepeatedPattern(secret)
    && !/^(change[-_ ]?me|replace[-_ ]?with|local-simulation-sidecar)/i.test(secret);
}

if (process.env.NODE_ENV === "production" && !process.env.SIM_INTERNAL_TOKEN) {
  console.error("FATAL: SIM_INTERNAL_TOKEN is required in production for the simulation sidecar.");
  process.exit(1);
}
if (!Number.isSafeInteger(SIM_PORT) || SIM_PORT < 1 || SIM_PORT > 65535) {
  console.error("FATAL: SIM_PORT must be an integer from 1 through 65535.");
  process.exit(1);
}
if (process.env.NODE_ENV === "production" && WEB_DEPLOYMENT && !isStrongSecret(process.env.SIM_INTERNAL_TOKEN)) {
  console.error("FATAL: SIM_INTERNAL_TOKEN must be a non-placeholder secret of at least 32 bytes.");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "2mb" }));

const store = initSimulationStore(DATA_DIR, {
  profilePath: process.env.SIM_PROFILE_DB_PATH || undefined,
  vectorPath: process.env.SIM_VECTOR_DB_PATH || undefined,
});

function requireInternalToken(req, res, next) {
  const token = req.headers["x-simulation-internal-token"];
  if (token !== SIM_INTERNAL_TOKEN) {
    return res.status(401).json({ error: "Simulation sidecar token required" });
  }
  next();
}

app.get("/health", (_req, res) => {
  try {
    const profilesReady = store.profileDb.prepare("SELECT 1 AS ok").get()?.ok === 1;
    const vectorsReady = store.vectorDb.prepare("SELECT 1 AS ok").get()?.ok === 1;
    if (!profilesReady || !vectorsReady) return res.status(503).json({ status: "not_ready" });
    return res.json({ status: "ok" });
  } catch {
    return res.status(503).json({ status: "not_ready" });
  }
});

app.post("/simulations", requireInternalToken, async (req, res) => {
  try {
    const result = await createSimulation(store, req.body || {}, { ttlDays: SIM_TTL_DAYS });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Simulation creation failed" });
  }
});

app.post("/internal/simulations/export", requireInternalToken, (req, res) => {
  try {
    res.json(exportStudentSimulations(store, req.body?.studentId));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Simulation export failed" });
  }
});

app.post("/internal/simulations/delete-all", requireInternalToken, (req, res) => {
  try {
    res.json(deleteAllStudentSimulations(store, req.body?.studentId));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Simulation deletion failed" });
  }
});

app.get("/simulations/:id", requireInternalToken, (req, res) => {
  try {
    const result = getSimulation(store, req.query.studentId, req.params.id);
    if (!result) return res.status(404).json({ error: "Simulation not found" });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Simulation lookup failed" });
  }
});

app.delete("/simulations/:id", requireInternalToken, (req, res) => {
  try {
    res.json(deleteSimulation(store, req.query.studentId, req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message || "Simulation deletion failed" });
  }
});

const server = app.listen(SIM_PORT, "127.0.0.1", () => {
  console.log(`[SIM] Sidecar listening on http://127.0.0.1:${SIM_PORT}`);
  console.log(`[SIM] Databases: ${store.profilePath}, ${store.vectorPath}`);
});

function shutdown() {
  server.close(() => {
    closeSimulationStore(store);
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
