package main

import (
	"bytes"
	"encoding/binary"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
)

const legacyColumnKeyID = "legacy-db-encryption-key"

func TestNewColumnSealerReadsLegacyCiphertextAndWritesStableEnvelope(t *testing.T) {
	legacyKey := strings.Repeat("l", 32)
	legacySealer, err := crypto.NewSealer(legacyKey)
	if err != nil {
		t.Fatalf("new legacy sealer: %v", err)
	}
	legacyCiphertext, err := legacySealer.SealString("legacy-refresh-token")
	if err != nil {
		t.Fatalf("seal legacy fixture: %v", err)
	}

	sealer, err := newColumnSealer(appconfig.Config{
		DBEncryptionKey:          legacyKey,
		DBEncryptionPrimaryKeyID: legacyColumnKeyID,
	})
	if err != nil {
		t.Fatalf("new column sealer: %v", err)
	}
	opened, err := sealer.OpenString(legacyCiphertext)
	if err != nil {
		t.Fatalf("open pre-keyring ciphertext: %v", err)
	}
	if opened != "legacy-refresh-token" {
		t.Fatalf("opened = %q, want legacy-refresh-token", opened)
	}

	sealed, err := sealer.SealString("new-refresh-token")
	if err != nil {
		t.Fatalf("seal versioned ciphertext: %v", err)
	}
	if got := envelopeKeyID(t, sealed); got != legacyColumnKeyID {
		t.Fatalf("envelope key ID = %q, want %q", got, legacyColumnKeyID)
	}
}

func TestNewColumnSealerRotatesPrimaryWhileRetainingLegacyReader(t *testing.T) {
	legacyKey := strings.Repeat("o", 32)
	newKey := strings.Repeat("n", 32)
	legacySealer, err := crypto.NewSealer(legacyKey)
	if err != nil {
		t.Fatalf("new legacy sealer: %v", err)
	}
	legacyCiphertext, err := legacySealer.SealString("existing-secret")
	if err != nil {
		t.Fatalf("seal legacy ciphertext: %v", err)
	}

	sealer, err := newColumnSealer(appconfig.Config{
		DBEncryptionPrimaryKeyID: "2026-08",
		DBEncryptionKeyringJSON: `{"` + legacyColumnKeyID + `":"` + legacyKey +
			`","2026-08":"` + newKey + `"}`,
	})
	if err != nil {
		t.Fatalf("new rotating column sealer: %v", err)
	}
	opened, err := sealer.OpenString(legacyCiphertext)
	if err != nil {
		t.Fatalf("open legacy ciphertext during rotation: %v", err)
	}
	if opened != "existing-secret" {
		t.Fatalf("opened = %q, want existing-secret", opened)
	}

	rotated, err := sealer.SealString(opened)
	if err != nil {
		t.Fatalf("reseal with new primary: %v", err)
	}
	if got := envelopeKeyID(t, rotated); got != "2026-08" {
		t.Fatalf("rotated envelope key ID = %q, want 2026-08", got)
	}
}

func TestNewColumnSealerFailsClosedForMissingPrimary(t *testing.T) {
	_, err := newColumnSealer(appconfig.Config{
		DBEncryptionKeyringJSON: `{"current":"` + strings.Repeat("k", 32) + `"}`,
	})
	if err == nil || !strings.Contains(err.Error(), "DB_ENCRYPTION_PRIMARY_KEY_ID must not be empty") {
		t.Fatalf("newColumnSealer error = %v, want missing-primary error", err)
	}
}

func envelopeKeyID(t *testing.T, sealed []byte) string {
	t.Helper()
	const fixedHeaderSize = 11
	if len(sealed) < fixedHeaderSize || !bytes.Equal(sealed[:8], []byte("RBSEALER")) {
		t.Fatalf("ciphertext does not contain a versioned envelope: %x", sealed)
	}
	keyIDLength := int(binary.BigEndian.Uint16(sealed[9:fixedHeaderSize]))
	if len(sealed) < fixedHeaderSize+keyIDLength {
		t.Fatalf("ciphertext has truncated key ID: %x", sealed)
	}
	return string(sealed[fixedHeaderSize : fixedHeaderSize+keyIDLength])
}
