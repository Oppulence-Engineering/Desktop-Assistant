# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /repo/apps/rowboat-www
COPY apps/rowboat-www/package.json apps/rowboat-www/package-lock.json apps/rowboat-www/.npmrc ./
COPY packages/relationship-contract /repo/packages/relationship-contract
COPY packages/ui /repo/packages/ui
RUN npm ci

FROM deps AS build
WORKDIR /repo/apps/rowboat-www
ENV NEXT_TELEMETRY_DISABLED=1
COPY apps/rowboat-www .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV ROWBOAT_WWW_PUBLIC_API_BASE_URL=https://api.oppulence.io
ENV ROWBOAT_WWW_API_PROXY_URL=https://api.oppulence.io
ENV ROWBOAT_WWW_PORT=8080

COPY --from=deps --chown=101:101 /repo/apps/rowboat-www/node_modules ./node_modules
COPY --from=deps --chown=101:101 /repo/packages/relationship-contract /packages/relationship-contract
COPY --from=build --chown=101:101 /repo/apps/rowboat-www/.next ./.next
COPY --from=build --chown=101:101 /repo/apps/rowboat-www/public ./public
COPY --from=build --chown=101:101 /repo/apps/rowboat-www/package.json ./package.json
COPY --chown=101:101 apps/rowboat-www/docker-entrypoint.sh /docker-entrypoint.sh

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${ROWBOAT_WWW_PORT}/healthz" >/dev/null || exit 1

USER 101:101
ENTRYPOINT ["/bin/sh", "/docker-entrypoint.sh"]
