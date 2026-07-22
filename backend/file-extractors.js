// ═══════════════════════════════════════════════════════════════════════
// FILE EXTRACTORS — text extraction dispatcher for EC attachments
// ═══════════════════════════════════════════════════════════════════════
// Pure async functions: Buffer in → { text, pageCount?, warning? } out.
// Supported types: PDF, plain text, DOCX, images (PNG/JPEG) via OCR.
//
// The OCR path is lazy-loaded because tesseract.js pulls in ~100 MB of
// language data. Small deployments that never upload images will not pay
// that cost unless extractImage() is actually invoked.
// ═══════════════════════════════════════════════════════════════════════

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);

const TESSERACT_CACHE_PATH = process.env.TESSERACT_CACHE_PATH || path.join(os.tmpdir(), "college-counselor-tesseract");

function ensureTesseractCache() {
  fs.mkdirSync(TESSERACT_CACHE_PATH, { recursive: true });
  return TESSERACT_CACHE_PATH;
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_EXTRACTED_CHARS = 50_000;

export const SUPPORTED_MIME_TYPES = Object.freeze({
  "application/pdf": "pdf",
  "text/plain": "text",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "image/png": "image",
  "image/jpeg": "image",
  "image/jpg": "image",
  "image/webp": "image",
});

export class ExtractionError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = "ExtractionError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

// ─── Buffer coercion ────────────────────────────────────────
function asBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (typeof input === "string") return Buffer.from(input, "utf8");
  throw new ExtractionError("invalid_input", "Expected a Buffer or Uint8Array");
}

// ─── Plain text ─────────────────────────────────────────────
export async function extractPlainText(input) {
  const buf = asBuffer(input);
  let text = buf.toString("utf8");
  // Strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { text, warning: null };
}

// ─── PDF ────────────────────────────────────────────────────
const PDF_TEXT_PAGE_LIMIT = 100;
let _pdfJsRef = null;
async function loadPdfJs() {
  if (_pdfJsRef) return _pdfJsRef;
  _pdfJsRef = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return _pdfJsRef;
}

export async function extractPDF(input) {
  const buf = asBuffer(input);
  let document = null;
  try {
    const pdfJs = await loadPdfJs();
    document = await pdfJs.getDocument({
      data: new Uint8Array(buf),
      disableWorker: true,
      verbosity: 0,
    }).promise;
    const pageLimit = Math.min(document.numPages, PDF_TEXT_PAGE_LIMIT);
    const pages = [];
    let extractedChars = 0;
    let stoppedForTextBudget = false;
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => `${String(item?.str || "")}${item?.hasEOL ? "\n" : " "}`)
        .join("")
        .trim();
      pages.push(text);
      extractedChars += text.length;
      page.cleanup?.();
      if (extractedChars > MAX_EXTRACTED_CHARS) {
        stoppedForTextBudget = pageNumber < document.numPages;
        break;
      }
    }
    const truncatedPages = document.numPages > pageLimit || stoppedForTextBudget;
    return {
      text: pages.join("\n\n"),
      pageCount: document.numPages,
      warning: truncatedPages
        ? `PDF extraction stopped at the ${PDF_TEXT_PAGE_LIMIT}-page/50,000-character safety limit.`
        : null,
    };
  } catch (err) {
    throw new ExtractionError("pdf_parse_failed", `PDF extraction failed: ${err.message}`, err);
  } finally {
    if (document) await document.destroy().catch(() => {});
  }
}

// ─── DOCX ───────────────────────────────────────────────────
let _mammothRef = null;
async function loadMammoth() {
  if (_mammothRef) return _mammothRef;
  _mammothRef = require("mammoth");
  return _mammothRef;
}

export async function extractDOCX(input) {
  const buf = asBuffer(input);
  try {
    const mammoth = await loadMammoth();
    const result = await mammoth.extractRawText({ buffer: buf });
    return {
      text: String(result?.value || ""),
      warning: Array.isArray(result?.messages) && result.messages.length
        ? `mammoth notes: ${result.messages.length}`
        : null,
    };
  } catch (err) {
    throw new ExtractionError("docx_parse_failed", `DOCX extraction failed: ${err.message}`, err);
  }
}

// ─── Image OCR (lazy) ───────────────────────────────────────
let _tesseractRef = null;
async function loadTesseract() {
  if (_tesseractRef) return _tesseractRef;
  _tesseractRef = require("tesseract.js");
  return _tesseractRef;
}

let _canvasRef = null;
async function loadCanvas() {
  if (_canvasRef) return _canvasRef;
  _canvasRef = require("@napi-rs/canvas");
  return _canvasRef;
}

export async function extractImage(input, { timeoutMs = 30_000, languages = "eng+kor" } = {}) {
  const buf = asBuffer(input);
  let timer;
  try {
    const tesseract = await loadTesseract();
    const recognizePromise = tesseract.recognize(buf, languages, {
      logger: () => {},
      cachePath: ensureTesseractCache(),
    });
    const text = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new ExtractionError("ocr_timeout", `OCR timed out after ${timeoutMs}ms`)), timeoutMs);
      recognizePromise
        .then((r) => resolve(String(r?.data?.text || "")))
        .catch((e) => reject(new ExtractionError("ocr_failed", `OCR failed: ${e.message}`, e)));
    });
    return { text, warning: text.trim().length === 0 ? "ocr_empty" : null };
  } catch (err) {
    if (err instanceof ExtractionError) throw err;
    throw new ExtractionError("ocr_failed", `OCR failed: ${err.message}`, err);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function extractPdfOCR(input, {
  timeoutMs = 60_000,
  languages = "eng",
  scale = 2,
  maxPages = 25,
} = {}) {
  const buf = asBuffer(input);
  let pdf = null;
  try {
    const pdfjsLib = await loadPdfJs();
    const { createCanvas } = await loadCanvas();
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buf),
      useSystemFonts: true,
      isEvalSupported: false,
      disableFontFace: true,
    });
    pdf = await loadingTask.promise;
    const pageCount = Number(pdf.numPages || 0) || 0;
    const pagesToRead = Math.min(pageCount, Math.max(1, Number(maxPages) || 1));
    const pageTexts = [];
    const warnings = [];

    for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const canvasContext = canvas.getContext("2d");
      await page.render({ canvasContext, viewport }).promise;
      const png = canvas.toBuffer("image/png");
      const ocr = await extractImage(png, { timeoutMs, languages });
      pageTexts.push(ocr.text || "");
      if (ocr.warning) warnings.push(`page_${pageNumber}:${ocr.warning}`);
      page.cleanup?.();
    }

    if (pageCount > pagesToRead) warnings.push(`truncated_pages:${pagesToRead}/${pageCount}`);
    const text = pageTexts.join("\n\n").trim();
    return {
      text,
      pageCount,
      warning: warnings.length ? warnings.join(";") : (text ? null : "ocr_empty"),
    };
  } catch (err) {
    if (err instanceof ExtractionError) throw err;
    throw new ExtractionError("pdf_ocr_failed", `PDF OCR failed: ${err.message}`, err);
  } finally {
    if (pdf) await pdf.destroy();
  }
}

// ─── Dispatcher ─────────────────────────────────────────────
/**
 * Dispatch to the right extractor by MIME type.
 * Truncates output to MAX_EXTRACTED_CHARS and sets warning if truncated.
 *
 * @param {Buffer|Uint8Array} input
 * @param {string} mimeType
 * @returns {Promise<{ text: string, pageCount?: number|null, warning?: string|null, kind: string }>}
 */
export async function extractText(input, mimeType) {
  const kind = SUPPORTED_MIME_TYPES[String(mimeType || "").toLowerCase()];
  if (!kind) {
    throw new ExtractionError("unsupported_mime", `Unsupported MIME type: ${mimeType}`);
  }

  let result;
  if (kind === "pdf") result = await extractPDF(input);
  else if (kind === "docx") result = await extractDOCX(input);
  else if (kind === "image") result = await extractImage(input);
  else result = await extractPlainText(input);

  let text = String(result?.text || "");
  let warning = result?.warning || null;
  if (text.length > MAX_EXTRACTED_CHARS) {
    text = text.slice(0, MAX_EXTRACTED_CHARS);
    warning = warning ? `${warning};truncated` : "truncated";
  }

  return {
    text,
    pageCount: result?.pageCount ?? null,
    warning,
    kind,
  };
}

export function isSupportedMime(mimeType) {
  return Boolean(SUPPORTED_MIME_TYPES[String(mimeType || "").toLowerCase()]);
}
