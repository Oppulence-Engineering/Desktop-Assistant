# Versioned encryption key rotation

The package has two construction modes:

- `NewSealer(passphrase)` and `NewSealerFromKey(key)` preserve the original `nonce || ciphertext` format and API.
- `NewKeyringSealer(primaryKeyID, keyring)` and `NewKeyringSealerFromKeys(primaryKeyID, keyring)` emit versioned envelopes and support rotation.

## Coordinator wiring API

The server/config coordinator should parse its environment configuration into a stable primary key ID and a keyring, then call exactly:

```go
sealer, err := crypto.NewKeyringSealer(
    primaryKeyID,        // string
    keyringPassphrases, // map[string]string: key ID -> secret passphrase
)
```

`NewKeyringSealer` applies the same SHA-256 derivation as the existing `NewSealer`. To deploy without losing access to existing rows, put the current `DB_ENCRYPTION_KEY` value in the initial keyring under a stable ID. The package intentionally does not define environment variable names or parsing because configuration and server wiring are outside this package.

For callers that already hold random AES-256 keys rather than passphrase strings, use:

```go
sealer, err := crypto.NewKeyringSealerFromKeys(
    primaryKeyID, // string
    keyring,      // map[string][]byte, every value exactly 32 bytes
)
```

Do not log either keyring. Key IDs are non-secret metadata, but key values and plaintext must never be logged.

## Envelope format

New keyring sealers write this binary format:

```text
"RBSEALER" || version-byte || uint16-be(key-id-length) || key-id || nonce || AES-256-GCM ciphertext-and-tag
```

Version 1 authenticates the complete envelope header, including the referenced key ID, together with any caller-provided AAD. `Open`/`OpenWithAAD` select only the key named by a versioned envelope. An absent key returns `ErrUnknownKeyID`. Invalid envelopes return `ErrMalformedCiphertext`, and unknown versions return `ErrUnsupportedVersion`.

Unversioned ciphertext is treated as the legacy `nonce || ciphertext` format. A keyring sealer tries the primary key first and then the remaining configured keys in stable key-ID order, allowing existing data to remain readable during migration.

## Rotation and retirement procedure

1. Add the new key to the keyring while retaining every old key.
2. Change `primaryKeyID` to the new key ID. All new `Seal` calls now use the new key and identify it in the envelope.
3. Run the connector inventory and resumable reseal job described below.
4. Run the retirement gate and retain its per-key/per-source report as operational evidence.
5. Only then remove the old key from the keyring.

Removing an old key before migration is deliberately not transparent. Versioned values for that key fail with `ErrUnknownKeyID`, and legacy values encrypted by that key fail authentication. This makes key retirement safe only after migration has completed.

## Connector inventory, reseal, and retirement gate

`cmd/connector-reencrypt` covers every live connector encrypted database payload
class, including active credentials, pending OAuth payloads, durable revocation
and orphan-credential cleanup and recovery work, legacy OAuth connection tables,
and the shared Redis refresh result cache. Immutable MCP/OAuth connection history
is not inventory: those tables retain lifecycle metadata and credential-presence
flags only. Reports contain aggregate and per-source counts for each key ID and
attribute legacy unversioned ciphertext to the key that successfully
authenticated it. Plaintext and key material are never reported.

Run the command with the same `DATABASE_URL`, optional `REDIS_URL`, and encryption
keyring configuration as the API:

```sh
go run ./cmd/connector-reencrypt inventory
go run ./cmd/connector-reencrypt reseal \
  --state-file /var/lib/rowboat/connector-reseal.json \
  --batch-size 250
go run ./cmd/connector-reencrypt inventory
go run ./cmd/connector-reencrypt retirement-gate --retire-key-id old-key-id
```

The reseal checkpoint is atomically persisted with mode `0600` after each database
batch and Redis scan page. Restarting with the same file resumes safely. Database
and Redis replacements use compare-and-swap, so a concurrent credential refresh
cannot be overwritten. A nonzero CAS-miss count requires another inventory/reseal
pass.

Refresh-result cache generations have bounded retention. The reseal inventory
scans the current `connectors:refresh:result:v2:` prefix and every explicitly
retained rolling prefix that may still contain readable ciphertext. When the
application advances the cache generation, add the new prefix to the inventory
before deployment and retain the previous prefix until its maximum TTL has
elapsed on every replica, including deployment overlap and clock skew. Do not
retire an encryption key while any retained cache generation or durable
`connector_credential_recoveries.refresh_token_encrypted` row still depends on
it. After the retention window, remove an obsolete prefix from the inventory in
a reviewed change so the scan remains bounded.

The retirement gate fails if the requested key is the active primary or if any
verified payload still depends on it. Keep the retiring key in
`DB_ENCRYPTION_KEYRING_JSON` and list it in
`DB_ENCRYPTION_RETIRING_KEY_IDS` until the gate passes. If Redis is not configured,
the command cannot inspect per-process refresh caches. Drain or restart API
processes, or wait at least the 90-second local cache TTL, before removing the key.
