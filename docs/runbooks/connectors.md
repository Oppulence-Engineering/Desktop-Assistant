# Connector Authorization Incident Runbooks

These procedures implement RFC 012 operations. Preserve timestamps, connector/environment, release SHA, affected organizations/connections, and audit query IDs in the incident record. Never paste tokens, OAuth state, client secrets, HMAC values, or database encryption keys into chat, tickets, or logs.

## Common controls

### Audit evidence classes

Connector authorization has two deliberately different evidence classes:

- **Guaranteed semantic authorization audits** are immutable, deterministic
  events such as `consent.shown`, `consent.granted`, `consent.denied`,
  `entitlement.check`, `token.minted`, and `token.revoked`. The consent service
  commits externally significant consent events to its PostgreSQL audit outbox
  before acknowledgement, and retries signed delivery to rowboat-api until it
  succeeds. Broker lifecycle events that share a state transition are written in
  the same database transaction. Use these records for authorization evidence.
- **Best-effort operational diagnostics** are process logs with
  `record_class=operational_diagnostic` and
  `delivery_guarantee=best_effort`. They help diagnose timeouts, dependency
  failures, and worker health, but loss or duplication is possible. Never use a
  log line as proof that an authorization decision or externally significant
  consent transition occurred.

During a rowboat-api or hook outage, verify the semantic outbox backlog remains
durable, its attempt count increases with bounded backoff, and the same
deterministic event ID is eventually acknowledged exactly once. Do not clear or
relabel pending rows to make dashboards green.

```bash
# Render before changing a release.
helm template rowboat-api charts/rowboat-api -f charts/rowboat-api/values-production.yaml > /tmp/rowboat-api.yaml
charts/rowboat-api/tests/deployment-contract.sh

# Emergency-disable one or more connectors without deleting grants.
helm upgrade rowboat-api charts/rowboat-api -n rowboat \
  -f charts/rowboat-api/values-production.yaml \
  --set-string config.CONNECTOR_EMERGENCY_DISABLED=canvas,corinthian --reuse-values --wait

# Observe rollout and retain the prior revision number.
helm history rowboat-api -n rowboat
kubectl rollout status deployment/rowboat-api -n rowboat --timeout=180s
```

The deployment gates resolve `mcpUrls` and `audiences` from the checked-in
registry for each environment. Staging MCP hosts must be `.staging.`-qualified,
production hosts must not be, and each product's staging audience must differ
from its production audience.

Production `high` and `money-moving` scopes are additionally fail-closed. A
scope cannot include `production` unless its connector has a
`productionApproval` record whose approved scopes exactly match the enabled
high-impact scopes and whose policy hash binds the production endpoint,
audience, scope controls, and action tools. The checked-in chart pins the digest
of the complete approval manifest, so a catalog or approval change without a
matching deployment evidence update fails the deployment contract.

```bash
# After the approval body exists, compute the policy hash to place in it.
python3 charts/hydra/product_approval.py \
  --registry apps/rowboat-api/internal/connectors/default_connectors.json \
  --print-policy-hash cadence

# Then compute the manifest digest to pin in values-production.yaml.
python3 charts/hydra/product_approval.py \
  --registry apps/rowboat-api/internal/connectors/default_connectors.json

# Both reusable negative/positive conformance tests and chart gates must pass.
python3 charts/hydra/tests/product-approval.test.py
charts/rowboat-api/tests/deployment-contract.sh
charts/hydra/tests/deployment-contract.sh
```

Do not invent approval metadata to make a render pass. Until a production
approval artifact exists and is reviewed, leave the high-impact scope limited
to development and staging.

A disable must stop new consent starts and resource-token mints. Existing rows remain available for investigation and are shown as degraded unless the incident requires invalidation.

## Provider outage

**Trigger:** authorization/token/revocation endpoint errors or elevated timeouts for one connector.

1. Confirm the problem from staging or a synthetic check without repeatedly refreshing user grants.
2. Add the connector to `CONNECTOR_EMERGENCY_DISABLED` and deploy.
3. Verify a new start and resource-token mint fail with a connector-unavailable result, not a generic 500.
4. Mark existing connections degraded in user/support communications. Do not bulk invalidate for a transient outage.
5. Track provider status and queue revocations that could not complete.
6. Re-enable only after authorization, token refresh, and revocation checks pass in staging and production canary.
7. Confirm audit events show disable/re-enable and no token material was logged.

## Credential custody blocks shutdown

**Trigger:** either `connector_credential_custody_in_flight > 0` or
`connector_credential_custody_shutdown_unresolved > 0`. These alerts page
immediately. The pod fails readiness as soon as custody work is admitted and
again as soon as shutdown begins.

This state means rowboat-api holds a provider credential for which neither the
PostgreSQL recovery journal nor provider revocation has acknowledged ownership.
The process keeps alternating bounded persistence and revocation attempts. Never
copy the credential into a ticket, log query, shell history, or Kubernetes event.

1. Stop voluntary operations that could remove the affected pod. Do not run a
   node drain, manual pod delete, rollout restart, downscale, or HPA minimum
   reduction. The chart uses rollout `maxUnavailable: 0`, an API PDB with
   `maxUnavailable: 1` plus `IfHealthyBudget`, disabled HPA scale-down, and
   readiness failure. One custody-unready pod consumes the entire PDB budget, so
   Kubernetes blocks every further voluntary eviction while work is unresolved.
2. Identify the affected pod from the alert's `pod`/`instance` labels and confirm
   the state without printing secrets:

   ```bash
   kubectl get pods -n rowboat -l app.kubernetes.io/name=rowboat-api
   kubectl logs -n rowboat POD --since=15m | \
     grep -E 'unresolved credential custody|accepted_work_unresolved|operator_action'
   kubectl get pdb -n rowboat rowboat-api
   ```

3. Restore at least one acknowledgement path. Prefer restoring PostgreSQL first
   so the encrypted recovery journal becomes durable. Otherwise restore the
   provider revocation endpoint. Watch both custody gauges return to zero and the
   pod become ready before resuming a rollout.
4. If SIGTERM has already been delivered, the server immediately fails readiness,
   drains public HTTP/gRPC for at most `SHUTDOWN_TIMEOUT` (25 seconds), then gives
   admitted custody work a separate 25-second drain window while `/metrics`
   remains scrapeable through the dedicated metrics Service, which publishes
   not-ready pod addresses without routing application traffic to them. Metrics
   are scraped every five seconds and the alert expressions retain any unresolved
   sample for five minutes, so the bounded drain cannot disappear between scrapes.
   Metrics and telemetry then have at most five seconds each to flush. The chart's
   65-second termination grace covers the complete bound.
5. A custody drain deadline returns an error, logs
   `accepted_work_unresolved` plus an explicit `operator_action`, and exits the
   process non-zero. Kubernetes retains the error logs through
   `FallbackToLogsOnError`. Treat that exit as an unresolved security incident,
   not a successful deployment. Preserve pod logs, alert history, release SHA,
   and dependency outage timestamps.
6. Do not weaken the PDB while either custody gauge is non-zero, or shorten
   termination grace to force progress. If an
   involuntary node/process loss occurs before either acknowledgement path
   succeeds, escalate to security, identify the connector and stable owner from
   non-secret structured fields, restore dependencies, run recovery/cleanup
   reconciliation, and require provider-side invalidation when custody cannot be
   proven.

Before planned node maintenance or capacity reduction, verify both custody gauges
are zero. When every API pod is ready, the PDB permits one voluntary disruption at
a time. Do not override the budget to evict an unready pod. Automatic HPA
scale-down remains disabled, so capacity reduction is always an explicit operator
change. Involuntary failures and direct pod deletion cannot be prevented by a PDB.

## Compromised connector secret

1. Emergency-disable the connector in every affected environment.
2. Revoke/rotate the provider OAuth client secret at the provider. Create a new secret rather than exposing the old value during diagnosis.
3. Update the external secret manager and roll rowboat-api. Never use `--set` for the secret.
4. Invalidate all unconsumed pending OAuth states for the connector.
5. Determine whether refresh tokens were exposed. If yes or unknown, invoke bulk invalidation for the connector, revoke upstream grants where available, delete encrypted token material, and require reauthorization.
6. Query audit data from the earliest possible compromise for starts, callbacks, refreshes, mints, denials, and invalidations.
7. Re-enable only after a clean end-to-end staging flow, production canary, and confirmation that the old secret fails.

## Bad catalog deploy

1. Emergency-disable affected connector starts/mints. Do not mutate existing grants while impact is unknown.
2. Identify the last known-good catalog/image SHA and diff scope names, required flags, tiers, audience, URLs, and environment markers.
3. Roll back rowboat-api/chart values to the known-good revision.
4. Verify existing grants are preserved and no callback accepted scopes outside requested/registered scopes.
5. Query consents created during the bad window. Invalidate only grants with unsafe scope or audience changes.
6. Correct the catalog, validate staging read/watch/act/money-moving behavior, then promote and re-enable.

## JWKS or audience rejection

**Symptoms:** product MCP returns 401 with `token_invalid_signature`, `audience_mismatch`, unknown `kid`, or clock errors.

1. Identify the token class before changing any verifier. Hydra access/refresh tokens belong only to the consent-plane flow. Product MCPs accept only short-lived connector resource tokens minted by rowboat-api.
2. Decode only a redacted test connector resource token locally. Compare `iss`, `aud`, `kid`, `exp`, `nbf`, and `iat` with product configuration. The canonical `iss` is the environment's externally reachable rowboat-api origin.
3. Fetch `/.well-known/connector-jwks.json` from the rowboat-api origin. Confirm TLS and that the signing `kid` is published. Do not substitute Hydra discovery or Hydra `/.well-known/jwks.json`.
4. Confirm the product uses the environment-specific issuer, connector JWKS URL, MCP endpoint, and audience from `charts/hydra/contracts/product-resource-servers.json`. The operator example in `docs/deployment-examples/product-resource-server.env.example` must match it, with RS256-only validation.
5. Check node clock skew. Do not widen skew beyond policy to hide clock problems.
6. On unknown `kid`, force one JWKS refresh. Do not disable signature verification or accept arbitrary algorithms.
7. If a key rotation caused rejection, restore the previous verification key/JWKS publication, then repeat rotation with overlap.
8. If production receives a staging audience or issuer, or a Hydra-issued token reaches a product MCP, disable the connector and investigate environment crossover or token-routing failure before re-enabling.

## Entitlement outage

1. Confirm whether the entitlement endpoint is timing out, returning non-2xx, malformed JSON, or incorrect denies.
2. Fail closed for new consent and resource-token mint. Preserve connection records and display a distinct entitlement-service-unavailable state.
3. If incorrect allows are possible, emergency-disable affected connectors immediately.
4. Query decisions by connector/result/reason without user IDs in metric labels. Record affected connection IDs in the secured incident artifact.
5. Restore the entitlement service and validate allowed, plan-required, and unavailable cases.
6. Re-evaluate affected active grants before re-enabling mint. Bulk invalidate grants created during an incorrect-allow window.

## Refresh-token reuse

**Trigger:** provider reuse detection, refresh family invalidation, or two refreshes using the same predecessor.

1. Emergency-disable resource-token mint for the connector if reuse is systemic.
2. Mark the connection `reauth_required` or `invalidated`; never retry the suspect refresh token.
3. Revoke the upstream token family where supported and erase local encrypted access/refresh material while retaining the audit tombstone.
4. Search for concurrent refreshes, copied credentials, and unexpected mint activity for that connection/user/org.
5. For confirmed compromise, bulk invalidate the affected connector/user/org set and rotate the provider client secret if warranted.
6. Require user reauthorization and verify only one serialized refresh path operates before re-enabling.

## Bulk invalidation

Bulk invalidation is destructive to active grants and requires incident commander approval plus a dry-run count.

1. Define the exact selector: connector, organization, user, connection IDs, environment, and time window.
2. Run the administrative invalidation endpoint/tool in dry-run mode if available. Export only IDs/statuses, never token ciphertext.
3. Compare the count with an independent database/audit query and obtain approval.
4. Disable new starts/mints for the selector's connector during execution.
5. Execute in bounded batches. For each connection, attempt upstream revocation, erase encrypted token material, retain a tombstone, and append an invalidation audit event.
6. Reconcile attempted/succeeded/failed counts. Retry upstream revocation separately without restoring local access.
7. Notify affected users that reauthorization is required, then re-enable only when the initiating incident is contained.

## Token and HMAC key rotation

- **Hydra system/cookie keys:** deploy `new,previous`, verify old and new sessions, wait through the applicable TTL, then remove previous.
- **Hydra signing keys/JWKS:** publish the new public key before signing with it. Keep the old public key through maximum token TTL plus skew.
- **rowboat-api connector signing keys/JWKS:** publish the new key from `/.well-known/connector-jwks.json` before switching `BROKER_TOKEN_KEY_ID`; keep the old key through `BROKER_TOKEN_TTL` plus verifier skew/cache TTL.
- **Consent hook HMAC:** deploy dual verification first when supported, switch signer, wait through consent TTL, remove old verifier. Otherwise disable consent during a coordinated rotation.
- **DB encryption key:** re-encrypt before retirement. If compromise prevents safe re-encryption, invalidate/revoke all affected grants and require reauthorization.

Record key identifiers and timestamps, never key material.

## OAuth pending-state hash-only closure

The expand/drain rollout is complete. Checked-in staging and production values
must keep `CONNECTOR_OAUTH_LEGACY_STATE_WRITE=false`. New binaries write
`state_hash`; the legacy column contains only a `sha256:` sentinel, never the
bearer state. `charts/rowboat-api/tests/deployment-contract.sh` and
`charts/hydra/tests/deployment-contract.sh` fail if either rendered environment
re-enables legacy writes.

Closure was permitted only after all rowboat-api replicas were hash-aware and
the 10-minute pending-state TTL plus clock skew had drained. To verify steady
state during a release:

1. Render both environment overlays and confirm the switch is exactly `false`.
2. Exercise start, cross-replica callback, claim, and replay rejection in
   staging, then in the production canary.
3. Confirm the raw bearer state does not occur in `oauth_pendings.state`, the
   `state_hash` lookup succeeds, and the legacy column contains the matching
   `sha256:` sentinel only.
4. Confirm no old replica or rollback candidate requires raw-state lookup before
   completing the rollout.

After closure, roll forward or require users with an in-flight flow to restart
authorization. Do not re-enable raw-state persistence to rescue a flow or to
roll back to a pre-hash binary. A later reviewed contract migration may remove
the legacy lookup/column after every supported release has stopped reading it.

## Emergency disable and re-enable

1. Add connector IDs to `CONNECTOR_EMERGENCY_DISABLED` in the environment overlay or emergency Helm override.
2. Render and confirm only intended IDs/environment are changed.
3. Deploy and test start plus resource-token mint denial.
4. Resolve incident and complete connector-specific staging checks.
5. Remove only resolved connector IDs, deploy canary, observe metrics/audit, then complete rollout.

## Rollback

1. Stop promotion and emergency-disable affected connectors if authorization behavior is unsafe.
2. Capture `helm history` and current image/config SHAs.
3. Roll back consent, rowboat-api, and Hydra independently to compatible revisions:

```bash
helm rollback oauth-consent <revision> -n rowboat --wait
helm rollback rowboat-api <revision> -n rowboat --wait
helm rollback hydra <revision> -n ory --wait
```

4. Do not roll back database migrations unless a reviewed down migration exists. Prefer forward repair.
5. Do not remove an old Hydra/JWKS/HMAC key while tokens or consent sessions issued by it remain valid.
6. Re-run health, discovery/JWKS, consent context/audit HMAC, entitlement denial, exact audience, and product 401/403/428 checks.
7. Re-enable connectors gradually. Keep grants created during the faulty window disabled or invalidated until reviewed.
