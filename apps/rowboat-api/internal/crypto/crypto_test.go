package crypto_test

import (
	"bytes"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
)

func TestSealOpenRoundTrip(t *testing.T) {
	s, err := crypto.NewSealer("a-test-passphrase")
	if err != nil {
		t.Fatalf("new sealer: %v", err)
	}
	plaintext := []byte("1//0g-refresh-token-secret")

	sealed, err := s.Seal(plaintext)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	if bytes.Contains(sealed, plaintext) {
		t.Fatal("sealed bytes must not contain plaintext")
	}

	out, err := s.Open(sealed)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if !bytes.Equal(out, plaintext) {
		t.Fatalf("round-trip mismatch: %q != %q", out, plaintext)
	}
}

func TestSealUsesFreshNonce(t *testing.T) {
	s, _ := crypto.NewSealer("pp")
	a, _ := s.Seal([]byte("same"))
	b, _ := s.Seal([]byte("same"))
	if bytes.Equal(a, b) {
		t.Fatal("two seals of the same plaintext must differ (random nonce)")
	}
}

func TestOpenRejectsTampered(t *testing.T) {
	s, _ := crypto.NewSealer("pp")
	sealed, _ := s.Seal([]byte("data"))
	sealed[len(sealed)-1] ^= 0xff // flip a ciphertext bit
	if _, err := s.Open(sealed); err == nil {
		t.Fatal("expected open of tampered ciphertext to fail (GCM auth)")
	}
}

func TestNewSealerRejectsEmpty(t *testing.T) {
	if _, err := crypto.NewSealer(""); err == nil {
		t.Fatal("expected error for empty passphrase")
	}
}
