import test from "node:test";
import assert from "node:assert/strict";

import {
  parseCdsRepositoryIndex,
  findBestRepositoryEntry,
  selectPreferredCdsLink,
  parseCdsText,
  parseCdsDocument,
  extractCdsDocumentText,
  extractC7TableRowsFromText,
  extractTargetSchoolNames,
  computeCdsQueryCacheKey,
  normalizeC7Object,
  normalizeC7TableRows,
  resolveAndParseCdsTargets,
} from "../cds-search.js";

test("parseCdsRepositoryIndex extracts schools, years, and links", () => {
  const html = `
    <table>
      <tr><th>Institution</th><th>2024-25</th><th>2023-24</th></tr>
      <tr>
        <td>Example University</td>
        <td><a href="https://example.edu/cds/2024-25.pdf">CDS</a></td>
        <td>CDS</td>
      </tr>
    </table>
  `;
  const entries = parseCdsRepositoryIndex(html);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].schoolName, "Example University");
  assert.equal(entries[0].years[0].available, true);
  assert.equal(entries[0].years[0].links[0].url, "https://example.edu/cds/2024-25.pdf");
  assert.equal(entries[0].years[1].available, true);
});

test("findBestRepositoryEntry fuzzy matches school names", () => {
  const entries = parseCdsRepositoryIndex(`
    <table><tr><th>Institution</th><th>2024-25</th></tr>
    <tr><td>University of Michigan</td><td><a href="https://umich.edu/cds.pdf">CDS</a></td></tr>
    </table>
  `);
  const match = findBestRepositoryEntry(entries, "Michigan");
  assert.ok(match);
  assert.equal(match.schoolName, "University of Michigan");
});

test("selectPreferredCdsLink skips google relay URLs when a direct URL exists", () => {
  const entry = {
    years: [
      {
        year: "2024-25",
        available: true,
        links: [
          { label: "CDS", url: "https://www.google.com/search?q=foo" },
          { label: "CDS", url: "https://school.edu/cds/latest.pdf" },
        ],
      },
    ],
  };
  const selected = selectPreferredCdsLink(entry);
  assert.equal(selected.url, "https://school.edu/cds/latest.pdf");
});

test("parseCdsText extracts key admissions signals", () => {
  const text = `
    Overall admission rate 9.1%
    Percent who actually enrolled 82.4%
    Average high school GPA of all degree-seeking, first-time, first-year 3.93
    SAT Evidence-Based Reading and Writing 740 SAT Math 790
    ACT Composite 34 ACT Composite 35
    Percent who had high school class rank in top tenth of graduating class 94%
    Rigor of secondary school record Very Important
    Academic GPA Very Important
    Standardized test scores Important
    Application essay Important
    Extracurricular activities Considered
  `;
  const parsed = parseCdsText(text);
  assert.equal(parsed.admitRatePercent, 9.1);
  assert.equal(parsed.yieldRatePercent, 82.4);
  assert.equal(parsed.gpaAverage, 3.93);
  assert.deepEqual(parsed.satComposite, { low: 740, high: 790 });
  assert.deepEqual(parsed.actComposite, { low: 34, high: 35 });
  assert.equal(parsed.classRankTop10Percent, 94);
  assert.equal(parsed.c7.rigor, 1);
  assert.equal(parsed.c7.standardizedTests, 0.7);
  assert.equal(parsed.c7.extracurriculars, 0.35);
});

function c7Line(label, ratingColumn) {
  const cols = [52, 74, 96, 121];
  const chars = Array(140).fill(" ");
  for (let i = 0; i < label.length; i += 1) chars[i] = label[i];
  chars[cols[ratingColumn]] = "X";
  return chars.join("").trimEnd();
}

test("extractC7TableRowsFromText normalizes OCR table rows into numeric C7 weights", () => {
  const text = [
    "Academic                                            Very Important       Important        Considered        Not Considered",
    c7Line("Rigor of secondary school record", 0),
    c7Line("Class rank", 2),
    c7Line("Academic GPA", 2),
    c7Line("Standardized test scores", 2),
    c7Line("Application Essay", 0),
    c7Line("Recommendation(s)", 0),
    "Nonacademic                                         Very Important       Important        Considered        Not Considered",
    c7Line("Interview", 3),
    c7Line("Extracurricular activities", 0),
    c7Line("Talent/ability", 0),
    c7Line("Character/personal qualities", 0),
    c7Line("First generation", 2),
    c7Line("Level of applicant’s interest", 3),
  ].join("\n");

  const result = extractC7TableRowsFromText(text);
  assert.equal(result.c7.rigor, 1);
  assert.equal(result.c7.classRank, 0.35);
  assert.equal(result.c7.academicGpa, 0.35);
  assert.equal(result.c7.standardizedTests, 0.35);
  assert.equal(result.c7.essay, 1);
  assert.equal(result.c7.recommendation, 1);
  assert.equal(result.c7.interview, 0);
  assert.equal(result.c7.extracurriculars, 1);
  assert.equal(result.c7.talentAbility, 1);
  assert.equal(result.c7.character, 1);
  assert.equal(result.c7.firstGeneration, 0.35);
  assert.equal(result.c7.levelOfInterest, 0);
  assert.ok(result.rows.every((row) => typeof row.numericWeight === "number"));
});

test("normalizeC7TableRows accepts spreadsheet-shaped rows and noisy labels", () => {
  const result = normalizeC7TableRows([
    { factorLabel: "Recommendation(s)", veryImportant: "X" },
    { factorLabel: "Talent/ability", selectedRating: "Very Important" },
    { factorLabel: "Character/personal qualities", considered: true },
    { factorLabel: "Level of applicant’s interest", notConsidered: "x" },
  ]);
  assert.equal(result.c7.recommendation, 1);
  assert.equal(result.c7.talentAbility, 1);
  assert.equal(result.c7.character, 0.35);
  assert.equal(result.c7.levelOfInterest, 0);
});

test("normalizeC7Object converts legacy CDS string ratings to positioning numeric keys", () => {
  const c7 = normalizeC7Object({
    class_rank: "considered",
    gpa: "very_important",
    test_scores: "not_considered",
    ec: "important",
  });
  assert.deepEqual(c7, {
    classRank: 0.35,
    academicGpa: 1,
    standardizedTests: 0,
    extracurriculars: 0.7,
  });
});

test("parseCdsText uses OCR-style C7 table fallback when prose ratings are absent", () => {
  const text = [
    "Common Data Set 2024-2025",
    "Academic                                            Very Important       Important        Considered        Not Considered",
    c7Line("Rigor of secondary school record", 0),
    c7Line("Academic GPA", 2),
    c7Line("Standardized test scores", 3),
    "Overall admission rate 11.4%",
  ].join("\n");
  const parsed = parseCdsText(text);
  assert.equal(parsed.admitRatePercent, 11.4);
  assert.equal(parsed.c7.rigor, 1);
  assert.equal(parsed.c7.academicGpa, 0.35);
  assert.equal(parsed.c7.standardizedTests, 0);
  assert.ok(parsed.c7TableRows.length >= 3);
});

test("parseCdsText lets OCR table rows override misleading flattened header text", () => {
  const text = [
    "Common Data Set 2024-2025",
    "Academic                                            Very Important       Important        Considered        Not Considered",
    c7Line("Rigor of secondary school record", 0),
    c7Line("Class rank", 2),
    c7Line("Academic GPA", 2),
    c7Line("Standardized test scores", 2),
    c7Line("Application Essay", 0),
    c7Line("Recommendation(s)", 0),
  ].join("\n");
  const parsed = parseCdsText(text);
  assert.equal(parsed.c7.rigor, 1);
  assert.equal(parsed.c7.classRank, 0.35);
  assert.equal(parsed.c7.academicGpa, 0.35);
  assert.equal(parsed.c7.standardizedTests, 0.35);
});

test("parseCdsDocument extracts text first, then parses CDS fields", async () => {
  const doc = Buffer.from(`
    <html><body>
    Common Data Set 2024-2025
    Overall admission rate 7.5%
    Percent who actually enrolled 71.2%
    Average high school GPA of all degree-seeking, first-time, first-year 3.91
    SAT Evidence-Based Reading and Writing 730 SAT Math 780
    ACT Composite 33 ACT Composite 35
    Rigor of secondary school record Very Important
    Academic GPA Very Important
    </body></html>
  `);

  const result = await parseCdsDocument(doc, { contentType: "text/html" });
  assert.equal(result.extraction.method, "html_text");
  assert.equal(result.parsed.admitRatePercent, 7.5);
  assert.equal(result.parsed.gpaAverage, 3.91);
  assert.deepEqual(result.parsed.satComposite, { low: 730, high: 780 });
});

test("extractCdsDocumentText falls back to injected PDF OCR when PDF text is low signal", async () => {
  let ocrCalled = false;
  const result = await extractCdsDocumentText(Buffer.from("%PDF fake"), {
    contentType: "application/pdf",
    pdfTextExtractor: async () => ({
      text: "tiny",
      pageCount: 2,
      warning: null,
    }),
    ocrPdfExtractor: async (_buf, context) => {
      ocrCalled = true;
      assert.equal(context.pageCount, 2);
      return {
        text: "Common Data Set 2024-2025 Overall admission rate 8.2%",
        pageCount: 2,
        warning: "ocr_low_confidence",
      };
    },
  });

  assert.equal(ocrCalled, true);
  assert.equal(result.extractionMethod, "pdf_ocr");
  assert.match(result.warning, /pdf_text_low_signal/);
  assert.match(result.warning, /ocr_low_confidence/);
  assert.match(result.text, /Overall admission rate 8\.2%/);
});

test("resolveAndParseCdsTargets records OCR extraction metadata for scanned PDFs", async () => {
  const repositoryHtml = `
    <table>
      <tr><th>Institution</th><th>2024-25</th></tr>
      <tr><td>Scanned College</td><td><a href="https://school.edu/cds.pdf">CDS</a></td></tr>
    </table>
  `;
  const fetchImpl = async (url) => {
    assert.equal(url, "https://school.edu/cds.pdf");
    return {
      ok: true,
      headers: { get: () => "application/pdf" },
      arrayBuffer: async () => Buffer.from("%PDF fake"),
    };
  };

  const [result] = await resolveAndParseCdsTargets(
    [{ schoolName: "Scanned College" }],
    {
      repositoryHtml,
      fetchImpl,
      pdfTextExtractor: async () => ({ text: "", pageCount: 4 }),
      ocrPdfExtractor: async () => ({
        text: "Common Data Set Overall admission rate 12.3% ACT Composite 31 ACT Composite 34",
        pageCount: 4,
      }),
    },
  );

  assert.equal(result.fetchStatus, "ok");
  assert.equal(result.sourceExtraction.method, "pdf_ocr");
  assert.equal(result.sourceExtraction.pageCount, 4);
  assert.equal(result.parsed.admitRatePercent, 12.3);
  assert.deepEqual(result.parsed.actComposite, { low: 31, high: 34 });
});

test("extractTargetSchoolNames resolves names from strings, objects, and fallback rows", () => {
  const results = extractTargetSchoolNames(
    [
      "Harvard University",
      { unitId: "166683" },
      { unitId: "166683", schoolName: "Harvard University" },
      { name: "Stanford University" },
    ],
    [{ unit_id: "166683", name: "Massachusetts Institute of Technology" }],
  );
  assert.deepEqual(results, [
    { unitId: null, schoolName: "Harvard University" },
    { unitId: "166683", schoolName: "Massachusetts Institute of Technology" },
    { unitId: "166683", schoolName: "Harvard University" },
    { unitId: null, schoolName: "Stanford University" },
  ]);
});

test("computeCdsQueryCacheKey is stable for equivalent targets", () => {
  const a = computeCdsQueryCacheKey([
    { unitId: "1", schoolName: "Stanford University" },
    { unitId: "2", schoolName: "Harvard University" },
  ]);
  const b = computeCdsQueryCacheKey([
    { unitId: "2", schoolName: " Harvard University " },
    { unitId: "1", schoolName: "stanford university" },
  ]);
  assert.equal(a, b);
});
