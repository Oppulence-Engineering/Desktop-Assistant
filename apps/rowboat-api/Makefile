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
	CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o bin/rowboat-api-worker ./cmd/worker

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
# api/openapi.json), then protobuf/gRPC, then the gqlgen server from ent.graphql,
# then the TypeScript SDK from the public OpenAPI contract.
#
# Toolchain required on the runner: protoc, buf, Node/npm, and the Go plugins
#   protoc-gen-go, protoc-gen-go-grpc, protoc-gen-entgrpc (go install).

GOBIN := $(shell go env GOPATH)/bin
SDK_TS_DIR := ../../packages/rowboat-api-client-ts

.PHONY: generate
generate: ent-generate proto-generate gql-generate sdk-generate

# ent + enthistory + entoas + OpenAPI enrichment + entgql (schema, history tables, OpenAPI, GraphQL SDL).
.PHONY: ent-generate
ent-generate:
	go generate ./ent

# entproto (.proto) + protoc (Go messages, gRPC service, ent-backed impl).
.PHONY: proto-generate
proto-generate:
	go run entgo.io/contrib/entproto/cmd/entproto -path ./ent/schema
	PATH="$(GOBIN):$$PATH" go generate ./ent/proto/entpb/...
	perl -0pi -e 's|(//\s*(?:-\s*)?protoc\s+)v[0-9][^\n]*|$${1}(version normalized)|g' ent/proto/entpb/*.pb.go

# gqlgen server (executor + resolvers) from the entgql-generated ent.graphql.
.PHONY: gql-generate
gql-generate:
	go generate ./internal/gqlapi/...

# TypeScript public SDK generated from api/openapi.json.
.PHONY: sdk-generate
sdk-generate:
	npm --prefix "$(SDK_TS_DIR)" ci --ignore-scripts
	npm --prefix "$(SDK_TS_DIR)" exec -- prettier --write ../../apps/rowboat-api/api/openapi.json
	npm --prefix "$(SDK_TS_DIR)" run generate
	npm --prefix "$(SDK_TS_DIR)" run build

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
