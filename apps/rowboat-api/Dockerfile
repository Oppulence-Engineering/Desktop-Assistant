# syntax=docker/dockerfile:1
# Multi-stage build → small, non-root, distroless runtime image.
#
# Build context is the REPO ROOT (not apps/rowboat-api) so the go.mod replace
#   github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go
#   => ../../packages/oauth-resource-server-go
# resolves. Build with:
#   docker build -f apps/rowboat-api/Dockerfile -t rowboat-api .
# (Dockerfile.dockerignore keeps the context to just the two Go modules.)

FROM golang:1.26 AS build
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
    CGO_ENABLED=0 GOOS=linux go build -trimpath -o /out/devstack ./cmd/devstack

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /
COPY --from=build /out/rowboat-api /rowboat-api
COPY --from=build /out/rowboat-api-worker /rowboat-api-worker
COPY --from=build /out/devstack /devstack

# 8080 = public HTTP/SSE · 8081 = gRPC · 9090 = Prometheus metrics
EXPOSE 8080 8081 9090
USER nonroot:nonroot
ENTRYPOINT ["/rowboat-api"]
