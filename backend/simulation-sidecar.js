import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  initSimulationStore,
  closeSimulationStore,
  createSimulation,
  getSimulation,
  deleteSimulation,
  cleanupExpiredSimulations,
} from "./simulation-engine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SIM_PORT = parseInt(process.env.SIM_PORT || "3002", 10);
const DATA_DIR = process.env.SIM_DATA_DIR || process.env.DATA_DIR || path.join(__dirname, "data");
const SIM_TTL_DAYS = parseInt(process.env.SIM_TTL_DAYS || "7", 10);
const SIM_INTERNAL_TOKEN = process.env.SIM_INTERNAL_TOKEN || "local-simulation-sidecar";

if (process.env.NODE_ENV === "production" && !process.env.SIM_INTERNAL_TOKEN) {
  console.error("FATAL: SIM_INTERNAL_TOKEN is required in production for the simulation sidecar.");
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
  const cleanup = cleanupExpiredSimulations(store);
  res.json({
    status: "ok",
    simulation: true,
    profileDb: path.basename(store.profilePath),
    vectorDb: path.basename(store.vectorPath),
    cleanup,
  });
});

app.post("/simulations", requireInternalToken, async (req, res) => {
  try {
    const result = await createSimulation(store, req.body || {}, { ttlDays: SIM_TTL_DAYS });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Simulation creation failed" });
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
