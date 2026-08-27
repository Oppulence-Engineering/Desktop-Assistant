# Connector Authorization Incident Runbooks

These procedures implement RFC 012 operations. Preserve timestamps, connector/environment, release SHA, affected organizations/connections, and audit query IDs in the incident record. Never paste tokens, OAuth state, client secrets, HMAC values, or database encryption keys into chat, tickets, or logs.

## Common controls

```bash
# Render before changing a release.
helm template rowboat-api charts/rowboat-api -f charts/rowboat-api/values-production.yaml > /tmp/rowboat-api.yaml

# Emergency-disable one or more connectors without deleting grants.
helm upgrade rowboat-api charts/rowboat-api -n rowboat \
  -f charts/rowboat-api/values-production.yaml \
  --set-string config.CONNECTOR_EMERGENCY_DISABLED=canvas,corinthian --reuse-values --wait

# Observe rollout and retain the prior revision number.
helm history rowboat-api -n rowboat
kubectl rollout status deployment/rowboat-api -n rowboat --timeout=180s
```

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

1. Decode only a redacted test token locally. Compare `iss`, `aud`, `kid`, `exp`, `nbf`, and `iat` with product configuration.
2. Fetch `/.well-known/openid-configuration` and JWKS from the configured issuer. Confirm TLS and that the signing `kid` is published.
3. Confirm the product uses the environment-specific audience from `docs/deployment-examples/product-resource-server.env.example` and RS256-only validation.
4. Check node clock skew. Do not widen skew beyond policy to hide clock problems.
5. On unknown `kid`, force one JWKS refresh. Do not disable signature verification or accept arbitrary algorithms.
6. If a key rotation caused rejection, restore the previous verification key/JWKS publication, then repeat rotation with overlap.
7. If production receives a staging audience or issuer, disable the connector and investigate environment crossover before re-enabling.

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
- **Consent hook HMAC:** deploy dual verification first when supported, switch signer, wait through consent TTL, remove old verifier. Otherwise disable consent during a coordinated rotation.
- **DB encryption key:** re-encrypt before retirement. If compromise prevents safe re-encryption, invalidate/revoke all affected grants and require reauthorization.

Record key identifiers and timestamps, never key material.

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
