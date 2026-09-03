#!/usr/bin/env bash
set -euo pipefail

chart_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

fail() {
  printf 'oauth-consent deployment contract failed: %s\n' "$*" >&2
  exit 1
}

command -v helm >/dev/null || fail "helm is required"

helm lint "$chart_dir" >/dev/null
helm template oauth-consent "$chart_dir" --show-only templates/deployment.yaml >"$tmp_dir/deployment.yaml"

grep -q '^      terminationGracePeriodSeconds: 30$' "$tmp_dir/deployment.yaml" ||
  fail "terminationGracePeriodSeconds must render as 30"
grep -q 'value: "20000"' "$tmp_dir/deployment.yaml" ||
  fail "SHUTDOWN_DEADLINE_MS must render below the pod termination grace"
grep -q '/drainz' "$tmp_dir/deployment.yaml" || fail "preStop must enter application draining"
grep -q '&& sleep 5' "$tmp_dir/deployment.yaml" || fail "preStop must allow readiness propagation"
grep -q '^            periodSeconds: 2$' "$tmp_dir/deployment.yaml" ||
  fail "readiness must observe draining promptly"
grep -q '^            failureThreshold: 1$' "$tmp_dir/deployment.yaml" ||
  fail "readiness must fail on the first draining response"

if helm template oauth-consent "$chart_dir" \
  --set shutdown.preStopDelaySeconds=5 \
  --set shutdown.applicationDeadlineSeconds=25 \
  --set shutdown.terminationGracePeriodSeconds=30 >"$tmp_dir/invalid.out" 2>"$tmp_dir/invalid.err"; then
  fail "an exhausted Kubernetes termination budget unexpectedly rendered"
fi
grep -q 'must be less than terminationGracePeriodSeconds' "$tmp_dir/invalid.err" ||
  fail "invalid shutdown budget did not report the deployment contract"

printf 'oauth-consent deployment contract passed\n'
