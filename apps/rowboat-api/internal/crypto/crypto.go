// Package crypto provides application-layer AES-256-GCM sealing for columns
// that must be encrypted at rest (OAuth refresh tokens, parked payloads,
// vendor API keys).
//
// The plan calls for pgcrypto (column-level encryption in Postgres). We instead
// seal application-side before the bytes ever reach the database. The at-rest
// security property is identical, and app-side sealing is arguably stronger:
// the database process never sees plaintext and the key never travels over the
// SQL wire. Legacy keys and keyring passphrases use the same SHA-256 derivation
// so existing DB_ENCRYPTION_KEY ciphertext remains decryptable during rotation.
package crypto

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
)

var (
	// ErrCiphertextTooShort is returned when legacy sealed input is malformed.
	ErrCiphertextTooShort = errors.New("crypto: ciphertext too short")
	// ErrMalformedCiphertext is returned when a versioned envelope is truncated
	// or otherwise structurally invalid.
	ErrMalformedCiphertext = errors.New("crypto: malformed ciphertext envelope")
	// ErrUnsupportedVersion is returned when an envelope version is not
	// understood by this package.
	ErrUnsupportedVersion = errors.New("crypto: unsupported ciphertext version")
	// ErrUnknownKeyID is returned when an envelope references a key that is not
	// present in the sealer's keyring. Keep old keys in the keyring until every
	// ciphertext they protect has been opened and resealed with the primary key.
	ErrUnknownKeyID = errors.New("crypto: unknown key id")
)

const (
	envelopeMagic                = "RBSEALER"
	envelopeVersion         byte = 1
	envelopeFixedHeaderSize      = len(envelopeMagic) + 1 + 2 // magic, version, uint16 key-id length
	maxKeyIDLength               = int(^uint16(0))
)

// Sealer seals and opens byte payloads with either a fixed legacy key or a
// versioned keyring. Sealers made by NewSealer and NewSealerFromKey retain the
// original nonce||ciphertext format. Sealers made by NewKeyringSealer or
// NewKeyringSealerFromKeys emit self-describing versioned envelopes.
type Sealer struct {
	aead          cipher.AEAD
	primaryKeyID  string
	keyring       map[string]cipher.AEAD
	legacyOpeners []cipher.AEAD
	legacyKeyIDs  []string
}

// NewSealer derives a 256-bit key from the passphrase (SHA-256) and builds a
// GCM AEAD. A non-empty passphrase is required.
//
// SECURITY: the key is a bare SHA-256 of DB_ENCRYPTION_KEY (no salt/stretching),
// and the derivation cannot change without making already-sealed data (OAuth
// refresh tokens, parked payloads, vendor API keys) undecryptable. DB_ENCRYPTION_KEY
// MUST therefore be a high-entropy, randomly generated 32-byte secret (e.g.
// `openssl rand -base64 32`) — never a human-chosen passphrase, which a single
// unsalted SHA-256 pass does nothing to protect against brute force.
func NewSealer(passphrase string) (*Sealer, error) {
	// Reject empty or whitespace-only keys so a misconfigured/blank
	// DB_ENCRYPTION_KEY fails loudly at startup instead of sealing data under a
	// trivially guessable key.
	if strings.TrimSpace(passphrase) == "" {
		return nil, errors.New("crypto: empty passphrase")
	}
	key := sha256.Sum256([]byte(passphrase))
	return NewSealerFromKey(key[:])
}

// NewSealerFromKey builds a sealer from an already-random 256-bit data key.
// Envelope-encryption callers use this path so a tenant DEK is not re-derived
// from a passphrase.
func NewSealerFromKey(key []byte) (*Sealer, error) {
	aead, err := newAEAD(key)
	if err != nil {
		return nil, err
	}
	return &Sealer{aead: aead}, nil
}

// NewKeyringSealer builds a rotating sealer from a primary key ID and a map of
// key IDs to high-entropy passphrases. New ciphertext is sealed with the primary
// key and embeds its key ID in a versioned envelope. Open selects the referenced
// key for versioned ciphertext and tries the configured keys for legacy
// nonce||ciphertext values, which carry no key ID.
//
// The primary key ID must be present in keyring. Key IDs are metadata, not
// secrets, and must be stable until all ciphertext using that ID is migrated.
// Passphrases use the same SHA-256 derivation as NewSealer so an existing
// DB_ENCRYPTION_KEY can be placed in the initial keyring without changing its
// cryptographic key.
func NewKeyringSealer(primaryKeyID string, keyring map[string]string) (*Sealer, error) {
	keys := make(map[string][]byte, len(keyring))
	for keyID, passphrase := range keyring {
		if strings.TrimSpace(passphrase) == "" {
			return nil, fmt.Errorf("crypto: key %q has an empty passphrase", keyID)
		}
		key := sha256.Sum256([]byte(passphrase))
		keys[keyID] = key[:]
	}
	return NewKeyringSealerFromKeys(primaryKeyID, keys)
}

// NewKeyringSealerFromKeys is the raw-key counterpart to NewKeyringSealer. Each
// keyring value must be an already-random 32-byte AES-256 key.
func NewKeyringSealerFromKeys(primaryKeyID string, keyring map[string][]byte) (*Sealer, error) {
	if strings.TrimSpace(primaryKeyID) == "" {
		return nil, errors.New("crypto: empty primary key id")
	}
	if len(primaryKeyID) > maxKeyIDLength {
		return nil, errors.New("crypto: primary key id is too long")
	}
	if len(keyring) == 0 {
		return nil, errors.New("crypto: empty keyring")
	}
	if _, ok := keyring[primaryKeyID]; !ok {
		return nil, fmt.Errorf("crypto: primary key id %q is not in keyring", primaryKeyID)
	}

	keyIDs := make([]string, 0, len(keyring))
	for keyID := range keyring {
		if strings.TrimSpace(keyID) == "" {
			return nil, errors.New("crypto: empty key id")
		}
		if len(keyID) > maxKeyIDLength {
			return nil, fmt.Errorf("crypto: key id %q is too long", keyID)
		}
		keyIDs = append(keyIDs, keyID)
	}
	sort.Strings(keyIDs)

	aeads := make(map[string]cipher.AEAD, len(keyring))
	for _, keyID := range keyIDs {
		aead, err := newAEAD(keyring[keyID])
		if err != nil {
			return nil, fmt.Errorf("crypto: key %q: %w", keyID, err)
		}
		aeads[keyID] = aead
	}

	primary := aeads[primaryKeyID]
	legacyOpeners := make([]cipher.AEAD, 0, len(aeads))
	legacyKeyIDs := make([]string, 0, len(aeads))
	legacyOpeners = append(legacyOpeners, primary)
	legacyKeyIDs = append(legacyKeyIDs, primaryKeyID)
	for _, keyID := range keyIDs {
		if keyID != primaryKeyID {
			legacyOpeners = append(legacyOpeners, aeads[keyID])
			legacyKeyIDs = append(legacyKeyIDs, keyID)
		}
	}

	return &Sealer{
		aead:          primary,
		primaryKeyID:  primaryKeyID,
		keyring:       aeads,
		legacyOpeners: legacyOpeners,
		legacyKeyIDs:  legacyKeyIDs,
	}, nil
}

// PrimaryKeyID returns the key ID used for new versioned envelopes. Legacy
// single-key sealers return an empty string because their ciphertext has no key
// metadata and they are not suitable for managed rotation.
func (s *Sealer) PrimaryKeyID() string { return s.primaryKeyID }

// CiphertextKeyID inspects an envelope without decrypting it. Versioned
// ciphertext returns its embedded key ID. Legacy nonce||ciphertext returns
// ("", false, nil) because attribution requires an authenticated decrypt.
func CiphertextKeyID(sealed []byte) (keyID string, versioned bool, err error) {
	_, keyID, _, versioned, err = parseEnvelope(sealed)
	return keyID, versioned, err
}

func newAEAD(key []byte) (cipher.AEAD, error) {
	if len(key) != 32 {
		return nil, errors.New("crypto: AES-256 key must be exactly 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("crypto: new cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("crypto: new gcm: %w", err)
	}
	return aead, nil
}

// Seal uses a fresh random nonce. A legacy sealer returns nonce||ciphertext; a
// keyring sealer returns a versioned envelope containing the primary key ID.
func (s *Sealer) Seal(plaintext []byte) ([]byte, error) {
	return s.SealWithAAD(plaintext, nil)
}

// SealWithAAD authenticates tenant/version metadata without storing it in the
// ciphertext body.
func (s *Sealer) SealWithAAD(plaintext, additionalData []byte) ([]byte, error) {
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("crypto: nonce: %w", err)
	}
	if s.keyring != nil {
		header := marshalEnvelopeHeader(s.primaryKeyID)
		authenticatedData := appendAAD(header, additionalData)
		sealed := make([]byte, len(header), len(header)+len(nonce)+len(plaintext)+s.aead.Overhead())
		copy(sealed, header)
		sealed = append(sealed, nonce...)
		return s.aead.Seal(sealed, nonce, plaintext, authenticatedData), nil
	}
	// Seal appends the ciphertext to nonce, so the nonce prefixes the output.
	return s.aead.Seal(nonce, nonce, plaintext, additionalData), nil
}

// Open reverses Seal.
func (s *Sealer) Open(sealed []byte) ([]byte, error) {
	return s.OpenWithAAD(sealed, nil)
}

// OpenAndKeyID decrypts ciphertext and reports the key that authenticated it.
// This is intended for inventory/re-encryption jobs. For legacy ciphertext a
// keyring sealer tries each configured key and returns the successful key ID.
func (s *Sealer) OpenAndKeyID(sealed []byte) ([]byte, string, error) {
	return s.OpenWithAADAndKeyID(sealed, nil)
}

// OpenWithAAD reverses SealWithAAD and fails authentication if the tenant or
// key version binding differs.
func (s *Sealer) OpenWithAAD(sealed, additionalData []byte) ([]byte, error) {
	out, _, err := s.OpenWithAADAndKeyID(sealed, additionalData)
	return out, err
}

// OpenWithAADAndKeyID is the AAD-aware form of OpenAndKeyID.
func (s *Sealer) OpenWithAADAndKeyID(sealed, additionalData []byte) ([]byte, string, error) {
	header, keyID, payload, versioned, err := parseEnvelope(sealed)
	if err != nil {
		return nil, "", err
	}
	if versioned {
		aead, ok := s.keyring[keyID]
		if !ok {
			return nil, keyID, fmt.Errorf("%w: %q", ErrUnknownKeyID, keyID)
		}
		if len(payload) < aead.NonceSize()+aead.Overhead() {
			return nil, keyID, ErrMalformedCiphertext
		}
		nonce, ct := payload[:aead.NonceSize()], payload[aead.NonceSize():]
		out, err := aead.Open(nil, nonce, ct, appendAAD(header, additionalData))
		if err != nil {
			return nil, keyID, fmt.Errorf("crypto: open: %w", err)
		}
		return out, keyID, nil
	}

	if s.keyring != nil {
		return s.openLegacyWithKeyringAndKeyID(sealed, additionalData)
	}
	out, err := openLegacy(s.aead, sealed, additionalData)
	return out, "", err
}

func (s *Sealer) openLegacyWithKeyringAndKeyID(sealed, additionalData []byte) ([]byte, string, error) {
	if len(sealed) < s.aead.NonceSize() {
		return nil, "", ErrCiphertextTooShort
	}
	var lastErr error
	for i, aead := range s.legacyOpeners {
		out, err := openLegacy(aead, sealed, additionalData)
		if err == nil {
			return out, s.legacyKeyIDs[i], nil
		}
		lastErr = err
	}
	return nil, "", lastErr
}

func openLegacy(aead cipher.AEAD, sealed, additionalData []byte) ([]byte, error) {
	ns := aead.NonceSize()
	if len(sealed) < ns {
		return nil, ErrCiphertextTooShort
	}
	nonce, ct := sealed[:ns], sealed[ns:]
	out, err := aead.Open(nil, nonce, ct, additionalData)
	if err != nil {
		return nil, fmt.Errorf("crypto: open: %w", err)
	}
	return out, nil
}

func marshalEnvelopeHeader(keyID string) []byte {
	header := make([]byte, envelopeFixedHeaderSize+len(keyID))
	copy(header, envelopeMagic)
	header[len(envelopeMagic)] = envelopeVersion
	// Key IDs are bounded by NewKeyringSealerFromKeys before a Sealer can reach
	// this helper, so the wire-format conversion cannot truncate.
	binary.BigEndian.PutUint16(header[len(envelopeMagic)+1:], uint16(len(keyID))) // #nosec G115
	copy(header[envelopeFixedHeaderSize:], keyID)
	return header
}

func parseEnvelope(sealed []byte) (header []byte, keyID string, payload []byte, versioned bool, err error) {
	if !bytes.HasPrefix(sealed, []byte(envelopeMagic)) {
		return nil, "", sealed, false, nil
	}
	if len(sealed) < envelopeFixedHeaderSize {
		return nil, "", nil, true, ErrMalformedCiphertext
	}
	version := sealed[len(envelopeMagic)]
	if version != envelopeVersion {
		return nil, "", nil, true, fmt.Errorf("%w: %d", ErrUnsupportedVersion, version)
	}
	keyIDLength := int(binary.BigEndian.Uint16(sealed[len(envelopeMagic)+1:]))
	if keyIDLength == 0 || len(sealed) < envelopeFixedHeaderSize+keyIDLength {
		return nil, "", nil, true, ErrMalformedCiphertext
	}
	headerLength := envelopeFixedHeaderSize + keyIDLength
	return sealed[:headerLength], string(sealed[envelopeFixedHeaderSize:headerLength]), sealed[headerLength:], true, nil
}

func appendAAD(header, additionalData []byte) []byte {
	authenticatedData := make([]byte, 0, len(header)+len(additionalData))
	authenticatedData = append(authenticatedData, header...)
	authenticatedData = append(authenticatedData, additionalData...)
	return authenticatedData
}

// SealString is a convenience wrapper over Seal.
func (s *Sealer) SealString(plaintext string) ([]byte, error) {
	return s.Seal([]byte(plaintext))
}

// OpenString is a convenience wrapper over Open.
func (s *Sealer) OpenString(sealed []byte) (string, error) {
	b, err := s.Open(sealed)
	if err != nil {
		return "", err
	}
	return string(b), nil
}
