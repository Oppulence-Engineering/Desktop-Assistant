# rowboat-api — build, test, lint, codegen, migrations.

SHELL := /bin/bash
MODULE := github.com/Oppulence-Engineering/rowboat/apps/rowboat-api
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo none)
DATE    ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
LDFLAGS := -X $(MODULE)/internal/version.Version=$(VERSION) \
           -X $(MODULE)/internal/version.Commit=$(COMMIT) \
           -X $(MODULE)/internal/version.Date=$(DATE)

.PHONY: all
all: generate build test

.PHONY: build
build:
	CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o bin/rowboat-api ./cmd/server

.PHONY: run
run:
	go run -ldflags "$(LDFLAGS)" ./cmd/server

.PHONY: test
test:
	go test ./... -race -count=1

.PHONY: vet
vet:
	go vet ./...

.PHONY: lint
lint:
	golangci-lint run ./...

.PHONY: fmt
fmt:
	gofmt -s -w .

.PHONY: tidy
tidy:
	go mod tidy

# ---- code generation -------------------------------------------------------
# `make generate` runs after every schema change and reproduces ALL generated
# artifacts. CI fails if generated files drift from source. Order matters:
# ent first (it runs ent + enthistory + entoas + entgql and writes ent.graphql +
# api/openapi.json), then protobuf/gRPC, then the gqlgen server from ent.graphql.
#
# Toolchain required on the runner: protoc, buf, and the Go plugins
#   protoc-gen-go, protoc-gen-go-grpc, protoc-gen-entgrpc (go install).

GOBIN := $(shell go env GOPATH)/bin

.PHONY: generate
generate: ent-generate proto-generate gql-generate

# ent + enthistory + entoas + OpenAPI enrichment + entgql (schema, history tables, OpenAPI, GraphQL SDL).
.PHONY: ent-generate
ent-generate:
	go generate ./ent

# entproto (.proto) + protoc (Go messages, gRPC service, ent-backed impl).
.PHONY: proto-generate
proto-generate:
	go run entgo.io/contrib/entproto/cmd/entproto -path ./ent/schema
	PATH="$(GOBIN):$$PATH" go generate ./ent/proto/entpb/...

# gqlgen server (executor + resolvers) from the entgql-generated ent.graphql.
.PHONY: gql-generate
gql-generate:
	go generate ./internal/gqlapi/...

# Install the protoc plugins the proto-generate target needs.
.PHONY: install-tools
install-tools:
	go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
	go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
	go install entgo.io/contrib/entproto/cmd/protoc-gen-entgrpc@latest

# ---- database migrations (Atlas, via ent) ----------------------------------

.PHONY: migrate-dump
migrate-dump:
	go run ./cmd/migrate dump $(name)

.PHONY: migrate-apply
migrate-apply:
	go run ./cmd/migrate apply

# ---- docker ----------------------------------------------------------------

.PHONY: docker-build
docker-build:
	docker build \
	  --build-arg VERSION=$(VERSION) \
	  --build-arg COMMIT=$(COMMIT) \
	  --build-arg DATE=$(DATE) \
	  -t rowboat-api:$(VERSION) .

.PHONY: clean
clean:
	rm -rf bin/
