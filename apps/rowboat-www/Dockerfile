# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime
ENV ROWBOAT_WWW_PUBLIC_API_BASE_URL=https://api.oppulence.io
ENV ROWBOAT_WWW_API_PROXY_URL=https://api.oppulence.io
ENV ROWBOAT_WWW_PORT=8080

COPY --from=build --chown=101:101 /app/out /usr/share/nginx/html
COPY docker-entrypoint.sh /docker-entrypoint.sh

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${ROWBOAT_WWW_PORT}/healthz" >/dev/null || exit 1

USER 101:101
ENTRYPOINT ["/bin/sh", "/docker-entrypoint.sh"]
