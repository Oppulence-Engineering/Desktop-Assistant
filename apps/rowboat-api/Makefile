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
	CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o bin/rowboat-api-scheduler ./cmd/scheduler

.PHONY: run
run:
	go run -ldflags "$(LDFLAGS)" ./cmd/server

.PHONY: test
test:
	go test ./... -count=1

.PHONY: test-race
test-race:
	go test ./... -race -count=1

.PHONY: vet
vet:
	go vet ./...

.PHONY: tfa-release-register-validate
tfa-release-register-validate:
	go run ./cmd/tfa-release-check --register ../../docs/trustworthy-first-account-beta/release-evidence.json --stage validate

.PHONY: tfa-release-governed-check
tfa-release-governed-check:
	go run ./cmd/tfa-release-check --register ../../docs/trustworthy-first-account-beta/release-evidence.json --stage design_partner_governed_action

GOLANGCI_LINT_VERSION := v2.12.2
GOIMPORTS_VERSION := v0.49.0
GOVULNCHECK_VERSION := v1.7.0
GITLEAKS_VERSION := v8.30.1
ARCH_GO_VERSION := v2.1.2
RULEGUARD_VERSION := v0.4.5
CONFTEST_VERSION := v0.69.0
AST_GREP_VERSION := 0.45.1

GOLANGCI_LINT ?= go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(GOLANGCI_LINT_VERSION)
GOIMPORTS ?= go run golang.org/x/tools/cmd/goimports@$(GOIMPORTS_VERSION)
GOVULNCHECK ?= go run golang.org/x/vuln/cmd/govulncheck@$(GOVULNCHECK_VERSION)
GITLEAKS ?= go run github.com/zricethezav/gitleaks/v8@$(GITLEAKS_VERSION)
ARCH_GO ?= go run github.com/arch-go/arch-go/v2@$(ARCH_GO_VERSION)
RULEGUARD ?= go run github.com/quasilyte/go-ruleguard/cmd/ruleguard@$(RULEGUARD_VERSION)
CONFTEST ?= go run github.com/open-policy-agent/conftest@$(CONFTEST_VERSION)
AST_GREP ?= npm exec --yes --package=@ast-grep/cli@$(AST_GREP_VERSION) -- ast-grep

# Handwritten Go only. Generated Ent, gqlgen, protobuf, and OpenAPI output must
# be changed through its source and generator, never formatted by hand.
GO_FILES := $(shell { \
	find cmd internal tools -type f -name '*.go' \
		! -path 'internal/gqlapi/generated.go' 2>/dev/null; \
	find ent/schema -type f -name '*.go'; \
	find ent -maxdepth 1 -type f \( -name 'entc.go' -o -name 'generate.go' \); \
} | sort -u)

.PHONY: lint
lint:
	$(GOLANGCI_LINT) run ./...

.PHONY: fmt
fmt:
	$(GOIMPORTS) -w $(GO_FILES)

.PHONY: fmt-check
fmt-check:
	@files="$$($(GOIMPORTS) -l $(GO_FILES))"; \
	if [[ -n "$$files" ]]; then \
		echo "Go files need goimports:"; echo "$$files"; exit 1; \
	fi

.PHONY: architecture
architecture:
	go test ./internal/qualityguard -run 'TestRepositoryGuard' -count=1
	$(ARCH_GO) --color=no

.PHONY: rowboatlint
rowboatlint:
	go test ./tools/rowboatlint/... -count=1
	go build -o /tmp/rowboatlint ./tools/rowboatlint
	go vet -vettool=/tmp/rowboatlint ./internal/... ./cmd/...

.PHONY: ruleguard
ruleguard:
	$(RULEGUARD) -test=false -rules rules/ruleguard/rules.go ./internal/... ./cmd/...

.PHONY: structural
structural:
	$(AST_GREP) scan --config sgconfig.yml

.PHONY: policy
policy:
	$(CONFTEST) test ../../.github/workflows/rowboat-api-quality.yml --policy policy
	$(CONFTEST) verify --policy policy

.PHONY: mod-verify
mod-verify:
	go mod verify
	go mod tidy -diff

.PHONY: security
security:
	$(GOVULNCHECK) ./...
	$(GITLEAKS) git ../../ --gitleaks-ignore-path ../../.gitleaksignore --redact --no-banner

.PHONY: verify
verify: fmt-check lint architecture rowboatlint ruleguard structural policy mod-verify test

.PHONY: verify-ci
verify-ci: verify test-race security

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
#
# Pinned, not @latest. These plugins stamp their own version into the files
# they generate, so floating them means the committed output drifts the moment
# upstream publishes — generate-drift then fails on every PR, including ones
# that touch nothing near the protos, and the diff is a version comment nobody
# changed. protoc-gen-go tracks the protobuf runtime in go.mod so the generator
# and the library it generates against can never disagree; the other two are
# versioned independently of anything in go.mod and are pinned by hand.
PROTOC_GEN_GO_VERSION := $(shell go list -m -f '{{.Version}}' google.golang.org/protobuf)
PROTOC_GEN_GO_GRPC_VERSION := v1.6.2
PROTOC_GEN_ENTGRPC_VERSION := v0.7.0

.PHONY: install-tools
install-tools:
	go install google.golang.org/protobuf/cmd/protoc-gen-go@$(PROTOC_GEN_GO_VERSION)
	go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@$(PROTOC_GEN_GO_GRPC_VERSION)
	go install entgo.io/contrib/entproto/cmd/protoc-gen-entgrpc@$(PROTOC_GEN_ENTGRPC_VERSION)

.PHONY: install-quality-tools
install-quality-tools:
	go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(GOLANGCI_LINT_VERSION)
	go install golang.org/x/tools/cmd/goimports@$(GOIMPORTS_VERSION)
	go install golang.org/x/vuln/cmd/govulncheck@$(GOVULNCHECK_VERSION)
	go install github.com/zricethezav/gitleaks/v8@$(GITLEAKS_VERSION)
	go install github.com/arch-go/arch-go/v2@$(ARCH_GO_VERSION)
	go install github.com/quasilyte/go-ruleguard/cmd/ruleguard@$(RULEGUARD_VERSION)
	go install github.com/open-policy-agent/conftest@$(CONFTEST_VERSION)
	npm install --global @ast-grep/cli@$(AST_GREP_VERSION)

.PHONY: generate-check
generate-check: generate
	git diff --exit-code -- ent api/openapi.json internal/gqlapi ../../packages/rowboat-api-client-ts

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
