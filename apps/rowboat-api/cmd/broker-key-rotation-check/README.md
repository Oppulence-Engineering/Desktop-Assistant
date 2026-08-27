# Broker signing-key rotation convergence gate

`broker-key-rotation-check` is the mandatory pre-activation and pre-retirement
gate for RFC 012 connector resource-token signing keys. Pass direct per-replica
JWKS URLs. A load-balancer URL is insufficient because it can repeatedly route to
one updated replica and hide a skewed rollout.

## Stage 1: publish the overlap keyring

Deploy the old active signer while every replica publishes both old and candidate
public keys. Do not activate the candidate until this succeeds:

```sh
go run ./cmd/broker-key-rotation-check \
  --phase activate \
  --replica-jwks-urls 'http://pod-a:8080/v1/connectors/.well-known/jwks.json,http://pod-b:8080/v1/connectors/.well-known/jwks.json' \
  --required-key-ids 'old-key,new-key' \
  --candidate-key-id new-key
```

The gate requires at least two direct replicas, canonical JWKS digest convergence,
and publication of every required key plus the candidate. Record the successful
JSON report and activation timestamp before changing the active signing key.

## Stage 2: activate and retain overlap

Activate the candidate only after Stage 1 passes. Continue publishing both keys
for at least the maximum token TTL plus verifier clock skew and cache allowance.
The default minimum is 17 minutes for the 15-minute maximum connector token TTL.

## Stage 3: pre-retirement proof

Before removing the old public key, prove that all replicas still publish the
converged overlap keyring and that the minimum interval elapsed:

```sh
go run ./cmd/broker-key-rotation-check \
  --phase retire \
  --replica-jwks-urls 'http://pod-a:8080/v1/connectors/.well-known/jwks.json,http://pod-b:8080/v1/connectors/.well-known/jwks.json' \
  --required-key-ids 'old-key,new-key' \
  --retiring-key-id old-key \
  --activated-at '2026-08-27T22:00:00Z' \
  --minimum-overlap 17m
```

Only a successful pre-retirement report authorizes a subsequent deployment that
removes the old key. Any direct-replica digest difference, missing key, HTTP error,
redirect, oversized document, or insufficient overlap exits nonzero.
