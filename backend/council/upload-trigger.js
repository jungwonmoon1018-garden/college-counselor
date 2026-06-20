// ═══════════════════════════════════════════════════════════════════════
// UPLOAD → COUNCIL CLASSIFIER
// ═══════════════════════════════════════════════════════════════════════
// Decides whether the text extracted from an EC supporting-file upload is
// semantically about EXTRACURRICULARS or COURSE SELECTION — and therefore
// worth auto-convening the Strategy Council on.
//
// Rules-first, embeddings-confirmed:
//   1. Cheap keyword/signal gate (deterministic, zero-cost, interpretable).
//      No signal → not relevant (return immediately). ≥2 distinct signals →
//      relevant, no model needed.
//   2. Borderline single-signal docs are confirmed by the embedded bge model
//      (cosine vs. anchor descriptions). When embeddings are unavailable we
//      stay conservative and treat a lone signal as NOT relevant.
//
// Returns { relevant, decisionType, score, signals, via }.
// ═══════════════════════════════════════════════════════════════════════

import { embed, isEmbeddingsAvailable } from "../llm-adapters/embedded-embeddings.js";
import { cosineSimilarity } from "../vector-store.js";
import { DECISION_TYPES } from "./triggers.js";
import { llmDebug } from "../llm-adapters/llm-log.js";

// Word-boundary patterns keep "art" out of "start", etc. Lowercased input.
const EC_SIGNALS = [
  /\bclubs?\b/, /\bcaptain\b/, /\bpresident\b/, /\bfound(?:ed|ing|er)\b/,
  /\bvolunteer(?:ing|ed)?\b/, /\bintern(?:ship)?\b/, /\bcompetitions?\b/,
  /\bolympiads?\b/, /\bhackathons?\b/, /\bawards?\b/, /\bmedals?\b/,
  /\bleadership\b/, /\brobotics\b/, /\bdebate\b/, /\bnon-?profit\b/,
  /\bfundraiser?s?\b/, /\bvarsity\b/, /\bensemble\b/, /\borchestra\b/,
  /\bmentor(?:ing|ed)?\b/, /\btutor(?:ing|ed)?\b/, /\bcommunity service\b/,
  /\bextra-?curricular?s?\b/, /\bresearch (?:project|lab)\b/, /\bpublished\b/,
];
const COURSE_SIGNALS = [
  /\bcourse (?:selection|load|catalog)\b/, /\bcourseworks?\b/, /\bclass schedule\b/,
  /\bap (?:exam|course|class|calculus|biology|chemistry|physics|us history)\b/,
  /\badvanced placement\b/, /\bib (?:diploma|hl|sl)\b/, /\bhonors (?:course|class|track)\b/,
  /\bprerequisites?\b/, /\bcurriculum\b/, /\btranscript\b/, /\bsemester\b/,
  /\bregistrar\b/, /\bcourse rigor\b/, /\belectives?\b/, /\bsyllabus\b/,
  /\bcredit hours?\b/, /\bnext year('?s)? schedule\b/, /\bsenior year schedule\b/,
  /\bclass(?:es)? (?:i'?m|i am|to) tak/, /\bschedule for next year\b/,
];

const EC_ANCHOR = "Extracurricular activities, clubs, leadership roles, volunteering, competitions, internships, and projects outside of class.";
const COURSE_ANCHOR = "Course selection and academic planning: which classes, AP or IB courses, electives, and schedule to take next year.";
// Cosine threshold for the borderline embeddings confirm. Tunable.
const SIM_THRESHOLD = 0.45;

let ANCHOR_CACHE = null; // { ec: Float32Array, course: Float32Array }

function countSignals(text, patterns) {
  const matched = [];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) matched.push(m[0]);
  }
  return { count: matched.length, matched };
}

async function getAnchors() {
  if (ANCHOR_CACHE) return ANCHOR_CACHE;
  const [ec, course] = await Promise.all([embed(EC_ANCHOR), embed(COURSE_ANCHOR)]);
  ANCHOR_CACHE = { ec, course };
  return ANCHOR_CACHE;
}

/**
 * @param {string} text  extracted document text
 * @param {{embeddingsOk?: boolean}} [opts]  pass a precomputed availability flag to skip the probe
 */
export async function classifyUploadForCouncil(text, opts = {}) {
  const clean = String(text || "").toLowerCase();
  if (!clean.trim()) return { relevant: false, decisionType: null, score: 0, signals: [], via: "empty" };

  const ec = countSignals(clean, EC_SIGNALS);
  const course = countSignals(clean, COURSE_SIGNALS);
  const total = ec.count + course.count;
  const signals = [...ec.matched, ...course.matched];
  const dominant = ec.count >= course.count ? DECISION_TYPES.EC_STRATEGY : DECISION_TYPES.COURSE_SELECTION;

  if (total === 0) {
    return { relevant: false, decisionType: null, score: 0, signals: [], via: "rules" };
  }

  // Strong rules match — no model needed.
  if (total >= 2) {
    llmDebug("COUNCIL", "upload classified (rules)", { decisionType: dominant, signals: signals.slice(0, 6) });
    return { relevant: true, decisionType: dominant, score: 1, signals, via: "rules" };
  }

  // Borderline single signal — confirm with embeddings when we can.
  const canEmbed = opts.embeddingsOk ?? (await isEmbeddingsAvailable());
  if (!canEmbed) {
    // Can't confirm → stay conservative (don't fire the Council on one weak hit).
    return { relevant: false, decisionType: dominant, score: 0.3, signals, via: "rules-only" };
  }
  try {
    const { ec: ecAnchor, course: courseAnchor } = await getAnchors();
    const v = await embed(String(text || "").slice(0, 2000));
    const ecSim = cosineSimilarity(v, ecAnchor);
    const courseSim = cosineSimilarity(v, courseAnchor);
    const best = Math.max(ecSim, courseSim);
    const decisionType = ecSim >= courseSim ? DECISION_TYPES.EC_STRATEGY : DECISION_TYPES.COURSE_SELECTION;
    const relevant = best >= SIM_THRESHOLD;
    llmDebug("COUNCIL", "upload classified (embeddings)", { relevant, decisionType, score: Number(best.toFixed(3)) });
    return { relevant, decisionType: relevant ? decisionType : dominant, score: best, signals, via: "embeddings" };
  } catch (err) {
    // Embeddings blew up — fall back conservatively to the rules verdict.
    llmDebug("COUNCIL", "upload embeddings confirm failed", { error: err?.message });
    return { relevant: false, decisionType: dominant, score: 0.3, signals, via: "rules-fallback" };
  }
}

export const _internals = { SIM_THRESHOLD, EC_SIGNALS, COURSE_SIGNALS };
