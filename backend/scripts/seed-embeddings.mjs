#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// SEED-EMBEDDINGS — populate vectors.db so RAG semantic search lights up
// ═══════════════════════════════════════════════════════════════════════
// Iterates over college profiles, EC exemplars, cached CDS PDFs, and skill
// documentation; embeds each chunk via the embedded ONNX bge-small model;
// upserts into the `embeddings` table. Idempotent on content_hash — rerun
// after content updates and only changed rows pay the embed cost.
// ═══════════════════════════════════════════════════════════════════════

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { initVectorStore, prepareVectorStatements, embedAndStore } from "../vector-store.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(MODULE_DIR, "..");
const DATA_DIR = path.join(BACKEND_ROOT, "data");

function log(...args) {
  console.log("[seed-embeddings]", ...args);
}

async function loadCollegeProfiles() {
  try {
    const mod = await import("../baseline-data.js");
    const profiles = mod.COLLEGE_PROFILES || mod.GENERATED_COLLEGE_PROFILES || {};
    return Object.entries(profiles).map(([slug, profile]) => ({
      source_type: "college_profile",
      source_id: slug,
      source_name: profile.name || profile.short_name || slug,
      content_text: [
        profile.name,
        profile.short_name,
        profile.location,
        profile.type,
        profile.programs_strong ? `Strong programs: ${profile.programs_strong.join(", ")}` : "",
        profile.values ? `Values: ${profile.values.join(", ")}` : "",
        profile.character ? `Character: ${profile.character}` : "",
        profile.notable ? `Notable: ${profile.notable}` : "",
      ].filter(Boolean).join(". "),
      metadata: { admit_rate: profile.admit_rate, sat_25: profile.sat_25, sat_75: profile.sat_75 },
    }));
  } catch (err) {
    log("Skipping college profiles:", err.message);
    return [];
  }
}

async function loadECExemplars() {
  try {
    const mod = await import("../crimson-ec-exemplars.js");
    const exemplars = mod.EC_EXEMPLARS || [];
    return exemplars.map((ec, idx) => ({
      source_type: "ec_exemplar",
      source_id: `exemplar_${idx}`,
      source_name: ec.title || `Exemplar ${idx}`,
      content_text: [ec.title, ec.description, ec.tier ? `Tier: ${ec.tier}` : ""].filter(Boolean).join(". "),
      metadata: { tier: ec.tier, category: ec.category },
    }));
  } catch (err) {
    log("Skipping EC exemplars:", err.message);
    return [];
  }
}

async function loadSkillSections() {
  const skillPath = path.join(BACKEND_ROOT, "skills", "collegeapp-ai", "SKILL.md");
  if (!fs.existsSync(skillPath)) return [];
  const raw = await fs.promises.readFile(skillPath, "utf-8");
  // Split on H2 headings — each section becomes one row.
  const sections = raw.split(/^##\s+/m).filter(Boolean);
  return sections.map((s, idx) => {
    const lines = s.split("\n");
    const heading = lines[0].trim();
    const body = lines.slice(1).join("\n").trim();
    return {
      source_type: "skill_section",
      source_id: `skill_${idx}`,
      source_name: heading,
      content_text: `${heading}. ${body.slice(0, 1500)}`,
      metadata: { skill: "collegeapp-ai" },
    };
  });
}

async function loadCdsSections() {
  const parsedDir = path.join(BACKEND_ROOT, "tools", "cds-cache", "parsed");
  if (!fs.existsSync(parsedDir)) return [];
  const files = await fs.promises.readdir(parsedDir);
  const rows = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await fs.promises.readFile(path.join(parsedDir, file), "utf-8");
      const data = JSON.parse(raw);
      const slug = file.replace(/\.json$/, "");
      // Section C / Section H summary as one row apiece.
      if (data.sections?.C) {
        rows.push({
          source_type: "cds_section",
          source_id: `${slug}_C`,
          source_name: `${data.school || slug} — Admissions (Section C)`,
          content_text: JSON.stringify(data.sections.C).slice(0, 4000),
          metadata: { school: data.school, section: "C", year: data.year },
        });
      }
      if (data.sections?.H) {
        rows.push({
          source_type: "cds_section",
          source_id: `${slug}_H`,
          source_name: `${data.school || slug} — Financial aid (Section H)`,
          content_text: JSON.stringify(data.sections.H).slice(0, 4000),
          metadata: { school: data.school, section: "H", year: data.year },
        });
      }
    } catch (err) {
      log(`Skipping ${file}:`, err.message);
    }
  }
  return rows;
}

async function main() {
  log("Initializing vector store...");
  const store = initVectorStore(DATA_DIR, process.env.NODE_ENV || "development");
  const stmts = prepareVectorStatements(store);

  const rows = [
    ...(await loadCollegeProfiles()),
    ...(await loadECExemplars()),
    ...(await loadSkillSections()),
    ...(await loadCdsSections()),
  ];

  if (rows.length === 0) {
    log("Nothing to seed (no source data found).");
    return;
  }

  log(`Embedding + storing ${rows.length} rows (this can take a few minutes on first run)...`);
  let done = 0;
  for (const row of rows) {
    try {
      await embedAndStore(stmts, row);
    } catch (err) {
      log(`! Failed for ${row.source_type}:${row.source_id} — ${err.message}`);
    }
    done++;
    if (done % 25 === 0) log(`  ${done}/${rows.length}`);
  }
  log(`Done. Stored ${done}/${rows.length} embedded rows.`);
  store.db.close();
}

main().catch((err) => {
  console.error("[seed-embeddings] FAILED:", err);
  process.exit(1);
});
