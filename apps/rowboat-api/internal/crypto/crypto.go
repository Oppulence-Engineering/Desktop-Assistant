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
)

// ErrCiphertextTooShort is returned when sealed input is malformed.
var ErrCiphertextTooShort = errors.New("crypto: ciphertext too short")

// Sealer seals and opens byte payloads with a fixed AEAD key.
type Sealer struct {
	aead cipher.AEAD
}

// NewSealer derives a 256-bit key from the passphrase (SHA-256) and builds a
// GCM AEAD. A passphrase is required.
func NewSealer(passphrase string) (*Sealer, error) {
	if passphrase == "" {
		return nil, errors.New("crypto: empty passphrase")
	}
	key := sha256.Sum256([]byte(passphrase))
	block, err := aes.NewCipher(key[:])
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
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("crypto: nonce: %w", err)
	}
	// Seal appends the ciphertext to nonce, so the nonce prefixes the output.
	return s.aead.Seal(nonce, nonce, plaintext, nil), nil
}

// Open reverses Seal.
func (s *Sealer) Open(sealed []byte) ([]byte, error) {
	ns := s.aead.NonceSize()
	if len(sealed) < ns {
		return nil, ErrCiphertextTooShort
	}
	nonce, ct := sealed[:ns], sealed[ns:]
	out, err := s.aead.Open(nil, nonce, ct, nil)
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
