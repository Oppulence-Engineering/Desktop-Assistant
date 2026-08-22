# syntax=docker/dockerfile:1
# Multi-stage build → small, non-root, distroless runtime image.
#
# Build context is the REPO ROOT (not apps/rowboat-api) so the go.mod replace
#   github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go
#   => ../../packages/oauth-resource-server-go
# resolves. Build with:
#   docker build -f apps/rowboat-api/Dockerfile -t rowboat-api .
# (Dockerfile.dockerignore keeps the context to just the two Go modules.)

FROM arigaio/atlas:1.3.0-community-distroless@sha256:57f5560604d8a9595eb2bbd91177a2455e33143842c5691e6cde2fa2c6f1a226 AS atlas

FROM golang:1.26.6 AS build
WORKDIR /src

# Module graph first (cache-friendly): both go.mod files, including the local
# replace target.
COPY apps/rowboat-api/go.mod apps/rowboat-api/go.sum ./apps/rowboat-api/
COPY packages/oauth-resource-server-go/go.mod ./packages/oauth-resource-server-go/
RUN --mount=type=cache,target=/go/pkg/mod \
    cd apps/rowboat-api && go mod download

# Sources.
COPY apps/rowboat-api ./apps/rowboat-api
COPY packages/oauth-resource-server-go ./packages/oauth-resource-server-go
RUN chmod -R a=rX /src/apps/rowboat-api/migrations/postgres

WORKDIR /src/apps/rowboat-api
ARG VERSION=dev
ARG COMMIT=none
ARG DATE=unknown
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -trimpath \
    -ldflags="-s -w \
      -X github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/version.Version=${VERSION} \
      -X github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/version.Commit=${COMMIT} \
      -X github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/version.Date=${DATE}" \
    -o /out/rowboat-api ./cmd/server && \
    CGO_ENABLED=0 GOOS=linux go build -trimpath \
    -ldflags="-s -w \
      -X github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/version.Version=${VERSION} \
      -X github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/version.Commit=${COMMIT} \
      -X github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/version.Date=${DATE}" \
    -o /out/rowboat-api-worker ./cmd/worker && \
    CGO_ENABLED=0 GOOS=linux go build -trimpath \
    -ldflags="-s -w \
      -X github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/version.Version=${VERSION} \
      -X github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/version.Commit=${COMMIT} \
      -X github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/version.Date=${DATE}" \
    -o /out/rowboat-api-scheduler ./cmd/scheduler && \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" \
    -o /out/rowboat-api-migrate ./cmd/migrate && \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -o /out/devstack ./cmd/devstack

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /
COPY --from=build /out/rowboat-api /rowboat-api
COPY --from=build /out/rowboat-api-worker /rowboat-api-worker
COPY --from=build /out/rowboat-api-scheduler /rowboat-api-scheduler
COPY --from=build /out/rowboat-api-migrate /rowboat-api-migrate
COPY --from=build /out/devstack /devstack
COPY --from=build /src/apps/rowboat-api/migrations/postgres /migrations/postgres
COPY --from=atlas /atlas /usr/local/bin/atlas

# 8080 = public HTTP/SSE · 8081 = gRPC · 9090 = Prometheus metrics
EXPOSE 8080 8081 9090
USER nonroot:nonroot
CMD ["/rowboat-api"]
