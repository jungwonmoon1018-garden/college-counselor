# College Counselor — Monorepo

A provider-agnostic (BYOK) AI college-application counselor, built rules-first
with FAFSA / FERPA / Korea-PIPA compliance, a PII vault (AES-256-GCM), an
evidence graph, and tiered LLM routing.

## Packages

| Path | Stack | Description |
|------|-------|-------------|
| [`backend/`](./backend) | Node/Express + better-sqlite3 (ESM) | API, PII vault, rules/positioning engine, CDS store, BYOK LLM routing, web grounding |
| [`frontend/`](./frontend) | React + Vite | Single-page counselor UI (chat, College Fit, ECs, courses, deadlines) |

This repo was combined from two previously separate repositories; the full
commit history of each is preserved under its subdirectory.

## Quick start (web/dev)

```bash
# Backend (http://localhost:3001)
cd backend && npm install && npm run dev

# Frontend (http://localhost:5173, proxies /api to :3001)
cd frontend && npm install && npm run dev
```

Backend databases live in `backend/data/` and are **gitignored** — they hold
real student PII and per-student BYOK API keys. Never commit them.

## Native / mobile clients

See [`docs/SESSION-SUMMARY.md`](./docs/SESSION-SUMMARY.md) for an architecture
and API orientation aimed at building macOS, Windows, and Android clients
against this backend.
