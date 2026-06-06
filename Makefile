SHELL := /bin/bash

ROWBOAT_KIND_SCRIPT := scripts/rowboat-api-kind.sh

.PHONY: help all stack api-up desktop smoke-desktop helm-validate infisical-validate validate validate-full validate-all status logs down delete-cluster

help:
	@printf "%s\n" \
	  "Rowboat local stack targets:" \
	  "" \
	  "  make stack          Build/deploy rowboat-api in kind, then run the desktop" \
	  "  make all            Alias for make stack" \
	  "  make api-up         Build/deploy rowboat-api in kind and run smoke checks" \
	  "  make desktop        Run the desktop against the kind API" \
	  "  make smoke-desktop  Drive the Electron app against the kind API" \
	  "  make helm-validate  Run Helm lint/template checks for kind/stage/prod values" \
	  "  make infisical-validate Validate Infisical sync for kind secrets" \
	  "  make validate       Run API smoke checks against the kind stack" \
	  "  make validate-full  Run Helm, Kubernetes, API, and desktop smoke checks" \
	  "  make status         Show kind resources and local stack state" \
	  "  make logs           Tail rowboat-api logs" \
	  "  make down           Remove the Helm release and local dependencies" \
	  "  make delete-cluster Delete the kind cluster" \
	  "" \
	  "The kind API is exposed at http://localhost:18080 and devstack at http://localhost:18090."

all: stack

stack:
	$(ROWBOAT_KIND_SCRIPT) up
	$(ROWBOAT_KIND_SCRIPT) desktop

api-up:
	$(ROWBOAT_KIND_SCRIPT) up

desktop:
	$(ROWBOAT_KIND_SCRIPT) desktop

smoke-desktop:
	$(ROWBOAT_KIND_SCRIPT) desktop-smoke

helm-validate:
	$(ROWBOAT_KIND_SCRIPT) helm-validate

infisical-validate:
	$(ROWBOAT_KIND_SCRIPT) infisical-validate

validate:
	$(ROWBOAT_KIND_SCRIPT) validate

validate-full:
	$(ROWBOAT_KIND_SCRIPT) validate-full

validate-all: validate-full

status:
	$(ROWBOAT_KIND_SCRIPT) status

logs:
	$(ROWBOAT_KIND_SCRIPT) logs

down:
	$(ROWBOAT_KIND_SCRIPT) down

delete-cluster:
	$(ROWBOAT_KIND_SCRIPT) delete-cluster
