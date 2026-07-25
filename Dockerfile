# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS frontend-build
ARG FRONTEND_BUILD=build:web
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run ${FRONTEND_BUILD}

FROM node:22-bookworm-slim AS backend-dependencies
WORKDIR /build/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    WEB_DEPLOYMENT=1 \
    HOST=0.0.0.0 \
    PORT=3001 \
    DATA_DIR=/var/lib/college-counselor

WORKDIR /app/backend
COPY --chown=node:node backend/ ./
COPY --from=backend-dependencies --chown=node:node /build/backend/node_modules ./node_modules
COPY --from=frontend-build --chown=node:node /build/frontend/dist ./public

RUN mkdir -p /var/lib/college-counselor && chown node:node /var/lib/college-counselor

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/api/ready').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "start-web.mjs"]
