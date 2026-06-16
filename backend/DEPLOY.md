# Deployment Guide

## Quick Start (Development)

```bash
cp .env.example .env     # fill in your keys
npm install
npm run dev              # auto-reload on changes
```

## Production Deployment

### 1. Environment Variables (Required)

```bash
ENCRYPTION_KEY=<64-char-hex>      # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=<64-char-hex>          # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
COUNSELOR_PASS=<strong-password>  # for /api/audit/dashboard
NODE_ENV=production
# OPENROUTER_API_KEY=sk-or-...    # OPTIONAL operator key (utility calls only); students BYOK
```

### 2. HTTPS with Caddy (Recommended)

Caddy auto-provisions Let's Encrypt certificates with zero config.

```bash
# Install Caddy
sudo apt install -y caddy          # Debian/Ubuntu
# or: brew install caddy           # macOS

# Edit Caddyfile — replace domain
nano Caddyfile
# Change "counselor.yourdomain.com" to your actual domain

# Ensure DNS A record points to this server

# Start Caddy
caddy run --config Caddyfile

# Start the Node.js backend
NODE_ENV=production node server.js
```

Caddy handles:
- Automatic TLS certificate provisioning and renewal
- HTTP -> HTTPS redirect
- Reverse proxy to Node.js on port 3001

### 3. Process Manager (Keep Server Running)

```bash
npm install -g pm2
pm2 start server.js --name counselor
pm2 save
pm2 startup   # auto-start on reboot
```

### 4. Update ALLOWED_ORIGINS

```bash
ALLOWED_ORIGINS=https://counselor.yourdomain.com
```

## Security Checklist

- [ ] Operator LLM key (`OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY`) — OPTIONAL; never commit to git
- [ ] `JWT_SECRET` set (min 32 chars, unique per environment)
- [ ] `ENCRYPTION_KEY` set (64-char hex)
- [ ] `COUNSELOR_PASS` set (strong password)
- [ ] `NODE_ENV=production`
- [ ] HTTPS enabled (Caddy / Cloudflare / nginx)
- [ ] `ALLOWED_ORIGINS` set to your frontend domain only
- [ ] Firewall: only ports 80/443 open (Caddy), 3001 bound to localhost
- [ ] SMTP configured for parental crisis notifications
- [ ] `.env` file NOT committed to git

## Architecture

```
Internet → Caddy (:443, HTTPS) → Node.js (:3001, HTTP)
                                    ↓
                              SQLite (data/counselor.db)
                                    ↓
                  Student BYOK provider via adapter layer
                  (OpenRouter by default; OpenAI / Google / etc.)
```

## Rate Limits

| Scope | Limit |
|---|---|
| Per-IP (general) | 30 req/min |
| Per-IP (audit) | 60 req/min |
| Per-IP (notify) | 3 per 5 min |
| Per-student (LLM, BYOK) | 30 calls/hour |
| Per-IP (Scorecard) | 40 req/min |

## LLM Providers

The backend is provider-agnostic and **OpenRouter-only by default** — Anthropic
has been removed. Each student supplies their own key (BYOK); an optional
operator key serves only unauthenticated utility calls.

### Supported providers

| Provider | Wire protocol | Default base URL |
|---|---|---|
| `openrouter`   | OpenAI-compatible | https://openrouter.ai/api/v1 |
| `openai`       | OpenAI Chat Completions | https://api.openai.com |
| `google`       | Gemini /generateContent | https://generativelanguage.googleapis.com |
| `deepseek`     | OpenAI-compatible | https://api.deepseek.com |
| `together`     | OpenAI-compatible | https://api.together.xyz/v1 |
| `zhipu`        | OpenAI-compatible | https://open.bigmodel.cn/api/paas/v4 |
| `ollama`       | OpenAI-compatible | http://localhost:11434/v1 |
| `lmstudio`     | OpenAI-compatible | http://localhost:1234/v1 |
| `openai_compat` | OpenAI-compatible | *(caller-supplied)* |

### Reasoning tiers

Every provider fills in a `small` / `medium` / `large` tier. Call
`POST /api/chat` with `{"tier":"small"}` (or `POST /api/llm`) and you get the
provider's small-tier model — e.g. a cheap Gemma/GLM model on OpenRouter,
gpt-4o-mini on OpenAI, gemini-2.0-flash on Google, llama3.2:3b on Ollama.
For OpenRouter the model dropdown is built from its live `/models` catalog
(`GET /api/llm/openrouter/models`). Defaults live in
`llm-adapters/tier-defaults.js` and can be overridden per-student via BYOK or
globally via env vars below.

Usage guidance:
- **small**: OCR, extraction, classification, narrative-fit fallback.
- **medium**: synthesis, coaching, college list building, trend analysis.
- **large**: essay critique, cross-source conflict resolution.

### Operator (server) fallback env vars

OPTIONAL — set one of these so the server has a key for unauthenticated
utility calls when no student BYOK is set. There is NO operator fallback for
student chat. The provider is auto-detected from the key; OpenRouter is
preferred.

```bash
OPENROUTER_API_KEY=sk-or-...        # OpenRouter (default/primary)
OPENAI_API_KEY=sk-...               # OpenAI or OpenAI-compatible
OPENAI_BASE_URL=                    # Optional: e.g. https://api.deepseek.com
GOOGLE_API_KEY=AIza...              # Google Gemini
LLM_SMALL_MODEL=                    # Optional tier override (e.g. google/gemma-4-26b-a4b-it)
LLM_MEDIUM_MODEL=                   # Optional tier override
LLM_LARGE_MODEL=                    # Optional tier override
```

### Ollama in Docker

If you're running Ollama on the host and the backend in a container,
point `OPENAI_BASE_URL` at the Docker host so the container can reach it:

```bash
OPENAI_BASE_URL=http://host.docker.internal:11434/v1
```

### Egress allow-list

If your infrastructure filters outbound traffic, allow-list whichever
hosts you use:

- `openrouter.ai` (default)
- `api.openai.com`
- `generativelanguage.googleapis.com`
- `api.deepseek.com`
- `api.together.xyz`
- `open.bigmodel.cn`
- Any custom `OPENAI_BASE_URL` / student-supplied `base_url`.

### BYOK (per-student keys)

`PUT /api/students/apikey` now accepts:

```json
{
  "apiKey": "sk-or-...",
  "provider": "openrouter",
  "baseUrl": "https://openrouter.ai/api/v1",
  "defaultModels": {
    "small":  "google/gemma-4-26b-a4b-it",
    "medium": "google/gemma-4-31b-it",
    "large":  "deepseek/deepseek-v4-pro"
  }
}
```

For OpenRouter the model dropdown is populated from its live `/models`
catalog. Omit `provider` / `baseUrl` and the backend auto-detects from the
key prefix (`sk-or-*` → openrouter, `sk-*` → openai, `AIza*` → google). The
student's key is stored encrypted (AES-256-GCM) in `pii-vault.db` and used
for future `/api/chat` and `/api/llm` calls on their behalf, including the
internal narrative-fit scorer.

## collegeapp-ai Skill Install

The repo ships a `collegeapp-ai` Claude Code skill that turns this
backend into a reasoning substrate for student application work. To
install it on the machine running Claude Code:

```bash
cp -r skills/collegeapp-ai ~/.claude/skills/
```

The skill reads two env vars:

```bash
export COLLEGEAPP_BACKEND_URL=https://counselor.yourdomain.com
export COLLEGEAPP_SESSION_TOKEN=<student-jwt>
```

See `skills/collegeapp-ai/SKILL.md` for the tiered reasoning recipe and
red-lines (FAFSA/FERPA citation rules, crisis handling, no-ghostwriting).

## EC Attachments + OCR Notes

The 4-factor EC strength vectorizer consumes uploaded supporting files
(PDF, DOCX, plain text, images). A few deployment consequences:

### Storage volume

Uploaded files live at `data/ec-attachments/{studentId}/{contentHash}.{ext}`.
In Docker/Kubernetes, mount this path as a persistent volume — otherwise
attachments are lost on container restart even though the sqlite rows
remain.

```
volumes:
  - ./data/ec-attachments:/app/data/ec-attachments
```

Per-file cap is 10 MB (`MAX_FILE_BYTES` in `file-extractors.js`). Plan for
roughly 1 GB per 100 heavy users.

### tesseract.js (OCR)

OCR for uploaded images (JPG/PNG) uses `tesseract.js` with the English +
Korean language packs. On first run, it downloads ~30 MB of traineddata
files per language and caches them.

- **Image size growth**: ~120 MB added to a Docker image if you pre-bake
  the traineddata files during build (recommended — otherwise the first
  request-after-deploy hangs while the worker downloads them).
- **Memory tier**: OCR briefly loads the language model into RAM. Run on
  a node with **≥ 1 GB available memory**; 512 MB tiers will OOM under
  concurrent OCR requests.
- **Timeout**: OCR is capped at 30 s per image. If your OCR workload is
  heavier than this, disable images by removing them from
  `SUPPORTED_MIME_TYPES` in `file-extractors.js`.

### Narrative-fit LLM shim

`narrative-fit-llm.js` scores hard-to-classify EC ↔ narrative alignments via
the shared adapter layer (`callLLM`) at the small tier — the student's own
BYOK provider (OpenRouter by default), falling back to the operator key if
one is set. These calls:

- Use the student's BYOK small-tier model (or the operator key fallback).
- Are cached in the `narrative_fit_cache` sqlite table (keyed by
  `sha256(narrative_hash + ":" + ec_text_hash)`), so repeated recomputes
  don't double-bill.
- Bypass the student-facing audit log and rate limiter on purpose — they
  are internal scoring calls, not student-initiated inference.

If you route traffic through a corporate proxy, allow-list whichever provider
host(s) you use (e.g. `openrouter.ai`) on the server's egress firewall.
