#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cluster_name="${KIND_CLUSTER_NAME:-rfc012-network-policy}"
scratch_root="${JCODE_SCRATCH_DIR:-${TMPDIR:-/tmp}}"
scratch="$scratch_root/$cluster_name"
calico_version="${CALICO_VERSION:-v3.29.3}"
consent_image="oauth-consent:rfc012-network-policy"

fail() {
  printf 'RFC 012 network-policy acceptance failed: %s\n' "$*" >&2
  exit 1
}

for command in docker kind kubectl helm curl; do
  command -v "$command" >/dev/null || fail "$command is required"
done
docker info >/dev/null 2>&1 || fail "Docker daemon is unavailable"

cleanup() {
  if [[ "${KEEP_KIND_CLUSTER:-0}" != "1" ]]; then
    kind delete cluster --name "$cluster_name" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

mkdir -p "$scratch"
cat >"$scratch/kind.yaml" <<'YAML'
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
networking:
  disableDefaultCNI: true
nodes:
  - role: control-plane
YAML

echo 'JCODE_CHECKPOINT {"message":"Building oauth-consent and creating policy-enforcing kind cluster"}'
docker build -t "$consent_image" "$repo_root/apps/oauth-consent"
kind create cluster --name "$cluster_name" --config "$scratch/kind.yaml" --wait 120s
kind load docker-image "$consent_image" --name "$cluster_name"

kubectl apply -f "https://raw.githubusercontent.com/projectcalico/calico/${calico_version}/manifests/calico.yaml"
kubectl -n kube-system rollout status daemonset/calico-node --timeout=240s
kubectl -n kube-system rollout status deployment/calico-kube-controllers --timeout=240s

for namespace in database ory rowboat other ingress-nginx; do
  kubectl create namespace "$namespace"
done

cat <<'YAML' | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
  namespace: database
spec:
  replicas: 1
  selector:
    matchLabels: { app: postgres }
  template:
    metadata:
      labels: { app: postgres }
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          env:
            - { name: POSTGRES_USER, value: oauth_consent }
            - { name: POSTGRES_PASSWORD, value: acceptance-password }
            - { name: POSTGRES_DB, value: oauth_consent }
          ports:
            - { name: postgresql, containerPort: 5432 }
          readinessProbe:
            exec:
              command: [pg_isready, -U, oauth_consent, -d, oauth_consent]
            periodSeconds: 2
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hydra
  namespace: ory
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: hydra
      app.kubernetes.io/instance: hydra
  template:
    metadata:
      labels:
        app.kubernetes.io/name: hydra
        app.kubernetes.io/instance: hydra
    spec:
      containers:
        - name: hydra
          image: oryd/hydra:v2.2.0
          args: [serve, all, --dev]
          env:
            - { name: DSN, value: memory }
            - { name: SECRETS_SYSTEM, value: acceptance-system-secret-at-least-32-bytes }
            - { name: SECRETS_COOKIE, value: acceptance-cookie-secret-at-least-32-bytes }
            - { name: URLS_SELF_ISSUER, value: http://hydra-public.ory.svc.cluster.local:4444 }
            - { name: URLS_LOGIN, value: http://oauth-consent.rowboat.svc.cluster.local/login }
            - { name: URLS_CONSENT, value: http://oauth-consent.rowboat.svc.cluster.local/consent }
          ports:
            - { name: public, containerPort: 4444 }
            - { name: admin, containerPort: 4445 }
          readinessProbe:
            httpGet: { path: /health/ready, port: admin }
            periodSeconds: 2
---
apiVersion: v1
kind: Service
metadata:
  name: hydra-admin
  namespace: ory
spec:
  selector:
    app.kubernetes.io/name: hydra
    app.kubernetes.io/instance: hydra
  ports:
    - { name: admin, port: 4445, targetPort: admin }
---
apiVersion: v1
kind: Service
metadata:
  name: hydra-public
  namespace: ory
spec:
  selector:
    app.kubernetes.io/name: hydra
    app.kubernetes.io/instance: hydra
  ports:
    - { name: public, port: 4444, targetPort: public }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hydra-impostor
  namespace: other
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: hydra
      app.kubernetes.io/instance: hydra
  template:
    metadata:
      labels:
        app.kubernetes.io/name: hydra
        app.kubernetes.io/instance: hydra
    spec:
      containers:
        - name: hydra
          image: oryd/hydra:v2.2.0
          args: [serve, all, --dev]
          env:
            - { name: DSN, value: memory }
            - { name: SECRETS_SYSTEM, value: acceptance-impostor-system-secret-32-bytes }
            - { name: SECRETS_COOKIE, value: acceptance-impostor-cookie-secret-32-bytes }
            - { name: URLS_SELF_ISSUER, value: http://hydra-impostor.other.svc.cluster.local:4444 }
            - { name: URLS_LOGIN, value: http://invalid.example/login }
            - { name: URLS_CONSENT, value: http://invalid.example/consent }
          ports:
            - { name: public, containerPort: 4444 }
            - { name: admin, containerPort: 4445 }
---
apiVersion: v1
kind: Service
metadata:
  name: hydra-impostor
  namespace: other
spec:
  selector:
    app.kubernetes.io/name: hydra
    app.kubernetes.io/instance: hydra
  ports:
    - { name: admin, port: 4445, targetPort: admin }
YAML

kubectl -n database rollout status deployment/postgres --timeout=180s
kubectl -n ory rollout status deployment/hydra --timeout=180s
kubectl -n other rollout status deployment/hydra-impostor --timeout=180s
postgres_ip="$(kubectl -n database get pod -l app=postgres -o jsonpath='{.items[0].status.podIP}')"
[[ -n "$postgres_ip" ]] || fail "could not resolve PostgreSQL pod IP"
database_url="postgresql://oauth_consent:acceptance-password@${postgres_ip}:5432/oauth_consent?sslmode=disable"

kubectl -n rowboat create secret generic oauth-consent-secrets \
  --from-literal=DATABASE_URL="$database_url" \
  --from-literal=WORKOS_CLIENT_ID=acceptance-client \
  --from-literal=WORKOS_API_KEY=acceptance-api-key \
  --from-literal=HOOK_HMAC_SECRET=acceptance-hook-secret-at-least-32-bytes \
  --from-literal=COOKIE_SECRET=acceptance-cookie-secret-at-least-32-bytes

echo 'JCODE_CHECKPOINT {"message":"Installing rendered default-deny policies and oauth-consent"}'
helm upgrade --install hydra-policy "$repo_root/charts/hydra/network-policy" \
  --namespace ory \
  -f "$repo_root/charts/hydra/network-policy/values-production.yaml" \
  --set-string "egress.postgresql.cidrs[0]=${postgres_ip}/32" \
  --wait
helm upgrade --install oauth-consent "$repo_root/charts/oauth-consent" \
  --namespace rowboat \
  -f "$repo_root/charts/oauth-consent/values-production.yaml" \
  --set replicaCount=1 \
  --set ingress.enabled=false \
  --set image.repository=oauth-consent \
  --set image.tag=rfc012-network-policy \
  --set image.pullPolicy=Never \
  --set-string "networkPolicy.postgresql.cidrs[0]=${postgres_ip}/32" \
  --wait --timeout 240s

# The chart's init container must have applied the real oauth-consent migrations.
table="$(kubectl -n database exec deployment/postgres -- psql -U oauth_consent -d oauth_consent -tAc "SELECT to_regclass('public.oauth_consent_sessions')")"
[[ "$table" == "oauth_consent_sessions" ]] || fail "oauth-consent migrations were not applied"

# /readyz performs a real database query and must return 200 through the Service.
kubectl -n rowboat run ready-probe --rm -i --restart=Never \
  --image=curlimages/curl:8.12.1 -- \
  curl --fail --silent --max-time 10 http://oauth-consent-oauth-consent:3000/readyz \
  | grep -q '"status":"ok"' || fail "oauth-consent /readyz did not return 200"

consent_pod="$(kubectl -n rowboat get pod -l app.kubernetes.io/component=oauth-consent -o jsonpath='{.items[0].metadata.name}')"
kubectl -n rowboat exec "$consent_pod" -- node -e \
  "fetch('http://hydra-admin.ory.svc.cluster.local:4445/health/ready',{signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# Matching Hydra labels in the wrong namespace must still be blocked by the
# oauth-consent egress namespace selector.
if kubectl -n rowboat exec "$consent_pod" -- node -e \
  "fetch('http://hydra-impostor.other.svc.cluster.local:4445/health/ready',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
  fail "oauth-consent reached a 4445 destination outside the Hydra namespace"
fi

# Hydra Admin accepts only labeled oauth-consent and reconciliation/operator pods.
kubectl -n ory run reconciler-probe --restart=Never --image=curlimages/curl:8.12.1 \
  --labels='app.kubernetes.io/component=hydra-client-reconciler,networking.rowboat.dev/hydra-admin-access=true' \
  --command -- sleep 300
kubectl -n ory wait --for=condition=Ready pod/reconciler-probe --timeout=90s
kubectl -n ory exec reconciler-probe -- curl --fail --silent --max-time 5 \
  http://hydra-admin:4445/health/ready >/dev/null

kubectl -n ory run unauthorized-probe --restart=Never --image=curlimages/curl:8.12.1 \
  --command -- sleep 300
kubectl -n ory wait --for=condition=Ready pod/unauthorized-probe --timeout=90s
if kubectl -n ory exec unauthorized-probe -- curl --fail --silent --max-time 3 \
  http://hydra-admin:4445/health/ready >/dev/null; then
  fail "unlabeled pod reached Hydra Admin port 4445"
fi

printf 'RFC 012 network-policy kind acceptance passed\n'
