package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto/reseal"
)

func TestCheckpointRoundTripAndPermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "checkpoint.json")
	want := reseal.Checkpoint{SourceIndex: 3, Cursor: "abc", CacheCursor: 42}
	if err := writeCheckpoint(path, want); err != nil {
		t.Fatal(err)
	}
	got, err := loadCheckpoint(path)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("checkpoint = %+v, want %+v", got, want)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("checkpoint permissions = %o, want 600", info.Mode().Perm())
	}
}

func TestLoadMissingCheckpointStartsFresh(t *testing.T) {
	state, err := loadCheckpoint(filepath.Join(t.TempDir(), "missing.json"))
	if err != nil || state != (reseal.Checkpoint{}) {
		t.Fatalf("load missing checkpoint = %+v, %v", state, err)
	}
}
