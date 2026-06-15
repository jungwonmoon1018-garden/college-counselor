import { useState, useEffect, useCallback } from "react";
import "./PreSignupPage.css";

// ═══════════════════════════════════════════════════════════════════════
// PreSignupPage — public, no-auth launch page (served at /pre-signup.html).
// Mission + honest impact metrics + beta signup + open-source contributor
// section + responsible-AI ethics + footer. Talks to two public backend
// routes: GET /api/beta-impact and POST /api/beta-signup.
// ═══════════════════════════════════════════════════════════════════════

const GITHUB_URL = "https://github.com/jungwonmoon1018-garden/college-counselor";

const GRADE_OPTIONS = [
  "8th grade", "9th grade", "10th grade", "11th grade", "12th grade",
  "Gap year", "College transfer", "Other",
];

const BACKGROUND_OPTIONS = [
  "First-generation student", "International student", "Low-income student",
  "Korean student applying abroad", "Student with limited counselor access",
  "General high school student", "Prefer not to say", "Other",
];

const HELP_OPTIONS = [
  "Extracurricular planning", "Course planning", "College list building",
  "Essay brainstorming", "Deadline tracking",
  "Scholarship / financial aid planning", "General application organization",
];

const FEEDBACK_OPTIONS = [
  "Yes, I can give feedback", "Maybe", "No, I only want to test the tool",
];

// Five honest metrics. Numbers come from /api/beta-impact; all start at 0.
const METRICS = [
  { key: "studentsJoinedBeta", name: "Students Joined Beta", desc: "Students who signed up to test the platform and provide feedback." },
  { key: "schoolsCommunitiesReached", name: "Schools / Communities Reached", desc: "Distinct schools or communities where students are using the tool." },
  { key: "ecPlansGenerated", name: "EC Plans Generated", desc: "Extracurricular plans students have built with the platform." },
  { key: "coursePlansGenerated", name: "Course Plans Generated", desc: "Major-aligned course sequences students have generated." },
  { key: "volunteerContributors", name: "Volunteer Contributors", desc: "People helping build, translate, review, or test the project." },
];

const EMPTY_FORM = {
  name: "", email: "", gradeLevel: "", schoolLocation: "",
  studentBackground: "", helpWanted: [], feedbackWillingness: "",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function PreSignupPage() {
  const [impact, setImpact] = useState({
    studentsJoinedBeta: 0, schoolsCommunitiesReached: 0,
    ecPlansGenerated: 0, coursePlansGenerated: 0, volunteerContributors: 0,
  });
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { type: "ok" | "err", text }

  const loadImpact = useCallback(async () => {
    try {
      const r = await fetch("/api/beta-impact");
      if (r.ok) setImpact(await r.json());
    } catch { /* backend may be down — keep honest zeros */ }
  }, []);

  useEffect(() => { loadImpact(); }, [loadImpact]);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const toggleHelp = (value) =>
    setForm((f) => ({
      ...f,
      helpWanted: f.helpWanted.includes(value)
        ? f.helpWanted.filter((h) => h !== value)
        : [...f.helpWanted, value],
    }));

  const submit = async (e) => {
    e.preventDefault();
    setResult(null);

    if (!form.name.trim() || !form.email.trim()) {
      setResult({ type: "err", text: "Name and email are required." });
      return;
    }
    if (!EMAIL_RE.test(form.email.trim())) {
      setResult({ type: "err", text: "Please enter a valid email address." });
      return;
    }

    setSubmitting(true);
    try {
      const r = await fetch("/api/beta-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, createdAt: new Date().toISOString() }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.success) {
        setForm(EMPTY_FORM);
        setResult({
          type: "ok",
          text: "Thanks for joining the beta. I'll use your feedback to improve the platform and expand access for more students.",
        });
        loadImpact(); // reflect the new signup count
      } else {
        setResult({ type: "err", text: data.error || "Something went wrong. Please try again." });
      }
    } catch {
      setResult({ type: "err", text: "Could not reach the server. Please check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  };

  const scrollToForm = () =>
    document.getElementById("beta")?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="ps-root">
      {/* ─── Hero ─── */}
      <header className="ps-hero">
        <div className="ps-container">
          <div className="ps-eyebrow">College Counselor AI · Open Source</div>
          <h1 className="ps-h1">AI College Counselor for Students Without Private Counseling Access</h1>
          <p className="ps-lead">
            A free, student-built platform that helps students organize extracurriculars,
            courses, college lists, deadlines, and application planning — without replacing
            their own voice.
          </p>
          <div className="ps-btn-row">
            <button type="button" className="ps-btn ps-btn-primary" onClick={scrollToForm}>Join the Beta</button>
            <a className="ps-btn ps-btn-secondary" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">View GitHub</a>
          </div>
        </div>
      </header>

      {/* ─── Mission ─── */}
      <section className="ps-section">
        <div className="ps-container">
          <h2 className="ps-h2">Why this exists</h2>
          <p className="ps-p">
            Private college counseling is expensive, and many students do not receive enough
            individualized guidance. This project is designed to give students a structured
            starting point for planning courses, extracurriculars, college lists, deadlines,
            and application narratives.
          </p>
          <p className="ps-p">
            The platform does not guarantee admission, write essays for students, or replace
            professional counselors. It helps students think, organize, and plan more clearly.
          </p>
        </div>
      </section>

      {/* ─── Impact ─── */}
      <section className="ps-section">
        <div className="ps-container">
          <h2 className="ps-h2">Impact We Are Tracking</h2>
          <div className="ps-metric-grid">
            {METRICS.map((m) => (
              <div className="ps-metric" key={m.key}>
                <div className="ps-metric-name">{m.name}</div>
                <div className="ps-metric-num">{impact[m.key] ?? 0}</div>
                <div className="ps-metric-desc">{m.desc}</div>
              </div>
            ))}
          </div>
          <p className="ps-note">
            We publish honest impact numbers. Early numbers may be small, but every signup and
            feedback response helps improve the platform.
          </p>
        </div>
      </section>

      {/* ─── Beta form ─── */}
      <section className="ps-section" id="beta">
        <div className="ps-container">
          <h2 className="ps-h2">Join the Beta Test</h2>
          <form className="ps-form" onSubmit={submit} noValidate>
            <div className="ps-field">
              <label className="ps-label" htmlFor="ps-name">Name</label>
              <input id="ps-name" className="ps-input" type="text" autoComplete="name"
                value={form.name} onChange={(e) => setField("name", e.target.value)} required />
            </div>

            <div className="ps-field">
              <label className="ps-label" htmlFor="ps-email">Email</label>
              <input id="ps-email" className="ps-input" type="email" autoComplete="email"
                value={form.email} onChange={(e) => setField("email", e.target.value)} required />
            </div>

            <div className="ps-field">
              <label className="ps-label" htmlFor="ps-grade">Grade level</label>
              <select id="ps-grade" className="ps-select"
                value={form.gradeLevel} onChange={(e) => setField("gradeLevel", e.target.value)}>
                <option value="">Select…</option>
                {GRADE_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>

            <div className="ps-field">
              <label className="ps-label" htmlFor="ps-school">School or location</label>
              <input id="ps-school" className="ps-input" type="text"
                value={form.schoolLocation} onChange={(e) => setField("schoolLocation", e.target.value)} />
            </div>

            <div className="ps-field">
              <label className="ps-label" htmlFor="ps-bg">Student background</label>
              <select id="ps-bg" className="ps-select"
                value={form.studentBackground} onChange={(e) => setField("studentBackground", e.target.value)}>
                <option value="">Select…</option>
                {BACKGROUND_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>

            <div className="ps-field">
              <span className="ps-label">What kind of help do you want?</span>
              <div className="ps-checks">
                {HELP_OPTIONS.map((h) => (
                  <label className="ps-check" key={h}>
                    <input type="checkbox" checked={form.helpWanted.includes(h)} onChange={() => toggleHelp(h)} />
                    <span>{h}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="ps-field">
              <label className="ps-label" htmlFor="ps-feedback">Would you be willing to give feedback?</label>
              <select id="ps-feedback" className="ps-select"
                value={form.feedbackWillingness} onChange={(e) => setField("feedbackWillingness", e.target.value)}>
                <option value="">Select…</option>
                {FEEDBACK_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>

            <button type="submit" className="ps-btn ps-btn-primary" disabled={submitting}>
              {submitting ? "Submitting..." : "Join the Beta"}
            </button>

            {result && (
              <div className={`ps-form-msg ${result.type}`} role="status">{result.text}</div>
            )}
          </form>
        </div>
      </section>

      {/* ─── Contributors ─── */}
      <section className="ps-section">
        <div className="ps-container">
          <h2 className="ps-h2">Help Build This</h2>
          <p className="ps-p">
            This project is open-source. Students, developers, counselors, translators, and
            educators can help improve the platform.
          </p>
          <div className="ps-role-grid">
            <div className="ps-role"><h3>Beta Tester</h3><p>Try the app and report confusing or broken parts.</p></div>
            <div className="ps-role"><h3>Student Ambassador</h3><p>Share the tool with students at your school or community.</p></div>
            <div className="ps-role"><h3>Content Reviewer</h3><p>Help check whether college-planning advice is clear and responsible.</p></div>
            <div className="ps-role"><h3>Translator</h3><p>Help make the platform more accessible in Korean and other languages.</p></div>
            <div className="ps-role"><h3>Developer Contributor</h3><p>Fix bugs, improve the UI, or add new features through GitHub.</p></div>
          </div>
          <div className="ps-btn-row">
            <a className="ps-btn ps-btn-primary" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">Contribute on GitHub</a>
            <button type="button" className="ps-btn ps-btn-secondary" onClick={scrollToForm}>Join as Volunteer</button>
          </div>
        </div>
      </section>

      {/* ─── Ethics ─── */}
      <section className="ps-section" id="responsible">
        <div className="ps-container">
          <h2 className="ps-h2">Responsible AI Use</h2>
          <div className="ps-ethics">
            <ul>
              <li>No admissions guarantees.</li>
              <li>No essay ghostwriting.</li>
              <li>Student data should be handled carefully and transparently.</li>
            </ul>
            <p className="ps-note" style={{ marginTop: 14 }}>
              The tool is meant to support student thinking, not replace the student's judgment,
              voice, or effort.
            </p>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="ps-footer">
        <div className="ps-container">
          <div className="ps-footer-title">College Counselor AI</div>
          <div className="ps-note" style={{ color: "#9fb0c8", marginTop: 4 }}>
            Student-built, open-source college planning support.
          </div>
          <div className="ps-footer-links">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href="#beta">Beta Signup</a>
            <a href="#responsible">Responsible AI</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
