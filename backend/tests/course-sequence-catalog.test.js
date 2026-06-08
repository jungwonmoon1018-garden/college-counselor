import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COURSE_SEQUENCES,
  GENERIC_SEQUENCE,
  getCourseSequence,
  diffCoursesAgainstSequence,
} from "../course-sequence-catalog.js";

test("COURSE_SEQUENCES catalog integrity", async (t) => {
  await t.test("every course has the required fields", () => {
    for (const [bucket, entry] of Object.entries(COURSE_SEQUENCES)) {
      assert.ok(entry.label, `${bucket} missing label`);
      assert.ok(Array.isArray(entry.courses) && entry.courses.length > 0, `${bucket} has no courses`);
      for (const c of entry.courses) {
        assert.ok(c.id, `${bucket} course missing id`);
        assert.ok(c.name, `${bucket} course missing name`);
        assert.ok(["foundational", "core", "advanced", "recommended"].includes(c.level), `${bucket}/${c.id} bad level: ${c.level}`);
        assert.ok(Array.isArray(c.match) && c.match.length > 0, `${bucket}/${c.id} missing match keywords`);
        assert.ok(typeof c.why === "string" && c.why.length > 0, `${bucket}/${c.id} missing why`);
      }
    }
  });

  await t.test("course ids are unique within a bucket", () => {
    for (const [bucket, entry] of Object.entries(COURSE_SEQUENCES)) {
      const ids = entry.courses.map((c) => c.id);
      assert.equal(new Set(ids).size, ids.length, `${bucket} has duplicate course ids`);
    }
  });
});

test("getCourseSequence", async (t) => {
  await t.test("returns the bespoke ladder for a known bucket", () => {
    const seq = getCourseSequence("computer_science");
    assert.equal(seq.bucket, "computer_science");
    assert.equal(seq.isGeneric, false);
    assert.ok(seq.courses.some((c) => c.apSubject === "AP_COMPUTER_SCIENCE_A"));
  });

  await t.test("falls back to the generic ladder for an unknown bucket", () => {
    const seq = getCourseSequence("underwater_basket_weaving");
    assert.equal(seq.isGeneric, true);
    assert.deepEqual(seq.courses, GENERIC_SEQUENCE.courses);
  });

  await t.test("treats null bucket as generic", () => {
    const seq = getCourseSequence(null);
    assert.equal(seq.isGeneric, true);
  });
});

test("diffCoursesAgainstSequence", async (t) => {
  await t.test("classifies taken courses into have, the rest into missing", () => {
    const courses = [
      { name: "AP Calculus AB", grade: "A" },
      { name: "AP Computer Science A", grade: "A" },
    ];
    const diff = diffCoursesAgainstSequence(courses, "computer_science");
    const haveIds = diff.have.map((c) => c.id).sort();
    assert.deepEqual(haveIds, ["calc_ab", "csa"]);
    // Everything in the ladder not taken is in missing.
    assert.ok(diff.missing.length > 0);
    assert.ok(diff.have.every((c) => c.matchedCourse));
  });

  await t.test("next prioritizes foundational/core over recommended and caps at 3", () => {
    const diff = diffCoursesAgainstSequence([], "computer_science");
    assert.ok(diff.next.length <= 3);
    // The first suggested gap should not be a 'recommended' course while
    // foundational/core gaps still exist.
    assert.notEqual(diff.next[0].level, "recommended");
  });

  await t.test("handles empty / non-array course input", () => {
    const diff = diffCoursesAgainstSequence(undefined, "biology");
    assert.equal(diff.have.length, 0);
    assert.ok(diff.missing.length > 0);
  });

  await t.test("matches courses case-insensitively via keywords", () => {
    const diff = diffCoursesAgainstSequence([{ name: "ap calc ab" }], "mathematics");
    assert.ok(diff.have.some((c) => c.id === "calc_ab"));
  });
});
