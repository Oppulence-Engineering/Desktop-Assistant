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
3. Migrate every encrypted value by calling `Open` then `Seal` with the rotating sealer. For AAD-bound data, call `OpenWithAAD` then `SealWithAAD` with the identical AAD.
4. Verify the migration covered all encrypted columns and records.
5. Only then remove the old key from the keyring.

Removing an old key before migration is deliberately not transparent. Versioned values for that key fail with `ErrUnknownKeyID`, and legacy values encrypted by that key fail authentication. This makes key retirement safe only after migration has completed.
