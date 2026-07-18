# Contributing to College Counselor AI

This is a student-built open-source project helping students access structured
college planning support.

Ways to help:

- Report bugs
- Suggest features
- Improve accessibility
- Improve Korean / English localization
- Review college-planning content
- Help test the beta

Please do not submit features that encourage essay ghostwriting, admissions
guarantees, or unsafe handling of student data.

## Getting started

```bash
git clone https://github.com/jungwonmoon1018-garden/college-counselor.git
cd college-counselor

# Backend (http://localhost:3001)
cd backend && npm install && npm run dev

# Frontend (http://localhost:5173)
cd frontend && npm install && npm run dev
```

The supported product is the packaged desktop application. Browser-only
launch and beta-signup pages are no longer shipped. Never advertise a retired
surface or fabricate adoption or impact metrics.

## Ground rules

- Keep the tone honest and education-access focused. No "get into the Ivy
  League" hype, and no admissions guarantees anywhere in the UI or copy.
- The platform supports student thinking; it does not write essays for students.
- Handle student data carefully and transparently. Do not log, expose, or commit
  real student data — `backend/data/` is gitignored for this reason.
- Open an issue to discuss larger changes before sending a big pull request.
