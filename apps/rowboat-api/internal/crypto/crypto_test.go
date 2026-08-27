package crypto_test

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"errors"
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

func TestKeyringSealerEmitsVersionedEnvelope(t *testing.T) {
	s, err := crypto.NewKeyringSealer("2026-08", map[string]string{
		"2026-08": "a-high-entropy-primary-test-key",
	})
	if err != nil {
		t.Fatalf("new keyring sealer: %v", err)
	}

	plaintext := []byte("refresh-token")
	sealed, err := s.Seal(plaintext)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}

	const fixedHeaderSize = 11
	if len(sealed) < fixedHeaderSize {
		t.Fatalf("versioned envelope too short: %d", len(sealed))
	}
	if got := string(sealed[:8]); got != "RBSEALER" {
		t.Fatalf("envelope magic = %q, want RBSEALER", got)
	}
	if got := sealed[8]; got != 1 {
		t.Fatalf("envelope version = %d, want 1", got)
	}
	keyIDLength := int(binary.BigEndian.Uint16(sealed[9:11]))
	if got := string(sealed[fixedHeaderSize : fixedHeaderSize+keyIDLength]); got != "2026-08" {
		t.Fatalf("envelope key id = %q, want 2026-08", got)
	}
	if bytes.Contains(sealed[fixedHeaderSize+keyIDLength:], plaintext) {
		t.Fatal("encrypted envelope payload must not contain plaintext")
	}

	opened, err := s.Open(sealed)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if !bytes.Equal(opened, plaintext) {
		t.Fatalf("round-trip mismatch: %q != %q", opened, plaintext)
	}
}

func TestKeyringSealerDecryptsLegacyCiphertext(t *testing.T) {
	// Fixed nonce||ciphertext fixture produced by the pre-keyring implementation
	// with NewSealer("legacy-key-material"). Keeping this static prevents a
	// change to the legacy format or key derivation from making the test vacuous.
	sealed, err := hex.DecodeString("000102030405060708090a0b0f9e3a5cd34fab914f6675e6642ab0751bb06a4109470bf082309e62466d576938b759ee")
	if err != nil {
		t.Fatalf("decode legacy fixture: %v", err)
	}

	rotating, err := crypto.NewKeyringSealer("new", map[string]string{
		"new": "new-key-material",
		"old": "legacy-key-material",
	})
	if err != nil {
		t.Fatalf("new keyring sealer: %v", err)
	}
	opened, err := rotating.OpenString(sealed)
	if err != nil {
		t.Fatalf("open legacy ciphertext: %v", err)
	}
	if opened != "legacy-refresh-token" {
		t.Fatalf("opened = %q, want legacy-refresh-token", opened)
	}
}

func TestKeyRotationAndRetirementAfterMigration(t *testing.T) {
	oldOnly, err := crypto.NewKeyringSealer("old", map[string]string{
		"old": "old-key-material",
	})
	if err != nil {
		t.Fatalf("new old sealer: %v", err)
	}
	oldCiphertext, err := oldOnly.SealString("secret")
	if err != nil {
		t.Fatalf("seal with old key: %v", err)
	}

	rotating, err := crypto.NewKeyringSealer("new", map[string]string{
		"old": "old-key-material",
		"new": "new-key-material",
	})
	if err != nil {
		t.Fatalf("new rotating sealer: %v", err)
	}
	plaintext, err := rotating.Open(oldCiphertext)
	if err != nil {
		t.Fatalf("open old envelope during rotation: %v", err)
	}
	migratedCiphertext, err := rotating.Seal(plaintext)
	if err != nil {
		t.Fatalf("reseal with primary key: %v", err)
	}

	retired, err := crypto.NewKeyringSealer("new", map[string]string{
		"new": "new-key-material",
	})
	if err != nil {
		t.Fatalf("new retired sealer: %v", err)
	}
	if _, err := retired.Open(oldCiphertext); !errors.Is(err, crypto.ErrUnknownKeyID) {
		t.Fatalf("open unmigrated ciphertext after retirement error = %v, want ErrUnknownKeyID", err)
	}
	opened, err := retired.OpenString(migratedCiphertext)
	if err != nil {
		t.Fatalf("open migrated ciphertext after retirement: %v", err)
	}
	if opened != "secret" {
		t.Fatalf("opened = %q, want secret", opened)
	}
}

func TestOpenRejectsUnknownKeyID(t *testing.T) {
	writer, err := crypto.NewKeyringSealer("missing", map[string]string{
		"missing": "missing-key-material",
	})
	if err != nil {
		t.Fatalf("new writer: %v", err)
	}
	sealed, err := writer.SealString("secret")
	if err != nil {
		t.Fatalf("seal: %v", err)
	}

	reader, err := crypto.NewKeyringSealer("current", map[string]string{
		"current": "current-key-material",
	})
	if err != nil {
		t.Fatalf("new reader: %v", err)
	}
	if _, err := reader.Open(sealed); !errors.Is(err, crypto.ErrUnknownKeyID) {
		t.Fatalf("open error = %v, want ErrUnknownKeyID", err)
	}
}

func TestOpenRejectsMalformedVersionedCiphertext(t *testing.T) {
	s, err := crypto.NewKeyringSealer("key", map[string]string{
		"key": "key-material",
	})
	if err != nil {
		t.Fatalf("new sealer: %v", err)
	}

	tests := []struct {
		name string
		in   []byte
		want error
	}{
		{name: "truncated header", in: []byte("RBSEALER\x01"), want: crypto.ErrMalformedCiphertext},
		{name: "empty key id", in: []byte("RBSEALER\x01\x00\x00"), want: crypto.ErrMalformedCiphertext},
		{name: "truncated key id", in: []byte("RBSEALER\x01\x00\x04ke"), want: crypto.ErrMalformedCiphertext},
		{name: "unsupported version", in: []byte("RBSEALER\x02\x00\x03key"), want: crypto.ErrUnsupportedVersion},
		{name: "missing encrypted payload", in: []byte("RBSEALER\x01\x00\x03key"), want: crypto.ErrMalformedCiphertext},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := s.Open(tt.in); !errors.Is(err, tt.want) {
				t.Fatalf("Open() error = %v, want %v", err, tt.want)
			}
		})
	}
}

func TestVersionedEnvelopeDetectsPayloadAndHeaderTampering(t *testing.T) {
	s, err := crypto.NewKeyringSealer("old", map[string]string{
		"old": "old-key-material",
		"new": "new-key-material",
	})
	if err != nil {
		t.Fatalf("new sealer: %v", err)
	}
	sealed, err := s.SealWithAAD([]byte("secret"), []byte("tenant-123"))
	if err != nil {
		t.Fatalf("seal: %v", err)
	}

	t.Run("payload", func(t *testing.T) {
		tampered := bytes.Clone(sealed)
		tampered[len(tampered)-1] ^= 0xff
		if _, err := s.OpenWithAAD(tampered, []byte("tenant-123")); err == nil {
			t.Fatal("expected payload tampering to fail authentication")
		}
	})

	t.Run("key id header", func(t *testing.T) {
		tampered := bytes.Clone(sealed)
		copy(tampered[11:14], "new") // same-length, configured key ID
		if _, err := s.OpenWithAAD(tampered, []byte("tenant-123")); err == nil {
			t.Fatal("expected authenticated key-id tampering to fail")
		}
	})

	t.Run("additional data", func(t *testing.T) {
		if _, err := s.OpenWithAAD(sealed, []byte("tenant-456")); err == nil {
			t.Fatal("expected additional-data tampering to fail")
		}
	})
}

func TestNewKeyringSealerValidatesConfiguration(t *testing.T) {
	tests := []struct {
		name    string
		primary string
		keyring map[string]string
	}{
		{name: "empty primary", primary: "", keyring: map[string]string{"key": "material"}},
		{name: "empty keyring", primary: "key", keyring: nil},
		{name: "primary absent", primary: "new", keyring: map[string]string{"old": "material"}},
		{name: "empty key id", primary: "new", keyring: map[string]string{"new": "material", "": "material"}},
		{name: "empty passphrase", primary: "new", keyring: map[string]string{"new": "  "}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := crypto.NewKeyringSealer(tt.primary, tt.keyring); err == nil {
				t.Fatal("expected configuration error")
			}
		})
	}

	if _, err := crypto.NewKeyringSealerFromKeys("key", map[string][]byte{
		"key": make([]byte, 31),
	}); err == nil {
		t.Fatal("expected raw-key length validation error")
	}
}

func TestKeyringSealerFromKeysRoundTrip(t *testing.T) {
	key := bytes.Repeat([]byte{0x42}, 32)
	s, err := crypto.NewKeyringSealerFromKeys("key", map[string][]byte{"key": key})
	if err != nil {
		t.Fatalf("new raw-key sealer: %v", err)
	}
	sealed, err := s.SealString("secret")
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	opened, err := s.OpenString(sealed)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if opened != "secret" {
		t.Fatalf("opened = %q, want secret", opened)
	}
}
