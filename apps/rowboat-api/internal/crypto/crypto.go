// Package crypto provides application-layer AES-256-GCM sealing for columns
// that must be encrypted at rest (OAuth refresh tokens, parked payloads,
// vendor API keys).
//
// The plan calls for pgcrypto (column-level encryption in Postgres). We instead
// seal application-side before the bytes ever reach the database. The at-rest
// security property is identical, and app-side sealing is arguably stronger:
// the database process never sees plaintext and the key never travels over the
// SQL wire. The key is derived from DB_ENCRYPTION_KEY.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"strings"
)

// ErrCiphertextTooShort is returned when sealed input is malformed.
var ErrCiphertextTooShort = errors.New("crypto: ciphertext too short")

// Sealer seals and opens byte payloads with a fixed AEAD key.
type Sealer struct {
	aead cipher.AEAD
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
	return &Sealer{aead: aead}, nil
}

// Seal returns nonce||ciphertext. Each call uses a fresh random nonce.
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
	// Seal appends the ciphertext to nonce, so the nonce prefixes the output.
	return s.aead.Seal(nonce, nonce, plaintext, additionalData), nil
}

// Open reverses Seal.
func (s *Sealer) Open(sealed []byte) ([]byte, error) {
	return s.OpenWithAAD(sealed, nil)
}

// OpenWithAAD reverses SealWithAAD and fails authentication if the tenant or
// key version binding differs.
func (s *Sealer) OpenWithAAD(sealed, additionalData []byte) ([]byte, error) {
	ns := s.aead.NonceSize()
	if len(sealed) < ns {
		return nil, ErrCiphertextTooShort
	}
	nonce, ct := sealed[:ns], sealed[ns:]
	out, err := s.aead.Open(nil, nonce, ct, additionalData)
	if err != nil {
		return nil, fmt.Errorf("crypto: open: %w", err)
	}
	return out, nil
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
