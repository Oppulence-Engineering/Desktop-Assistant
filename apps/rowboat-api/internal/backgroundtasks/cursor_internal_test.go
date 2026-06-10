package backgroundtasks

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestParseRunCursor(t *testing.T) {
	ts := time.Date(2026, 1, 2, 3, 4, 5, 123456000, time.UTC)
	id := uuid.New()

	// Composite cursor round-trips to (created_at, id).
	cur := ts.UTC().Format(time.RFC3339Nano) + runCursorSep + id.String()
	gotTs, gotID, err := parseRunCursor(cur)
	if err != nil {
		t.Fatalf("composite: %v", err)
	}
	if !gotTs.Equal(ts) {
		t.Fatalf("composite ts = %v, want %v", gotTs, ts)
	}
	if gotID != id {
		t.Fatalf("composite id = %v, want %v", gotID, id)
	}

	// Legacy timestamp-only cursor → uuid.Nil id (handled as a non-keyset filter).
	gotTs2, gotID2, err := parseRunCursor(ts.UTC().Format(time.RFC3339Nano))
	if err != nil {
		t.Fatalf("legacy: %v", err)
	}
	if !gotTs2.Equal(ts) || gotID2 != uuid.Nil {
		t.Fatalf("legacy = (%v, %v), want (%v, Nil)", gotTs2, gotID2, ts)
	}

	// Garbage and a bad id component are rejected.
	if _, _, err := parseRunCursor("not-a-time"); err == nil {
		t.Fatal("garbage cursor should error")
	}
	if _, _, err := parseRunCursor(ts.UTC().Format(time.RFC3339Nano) + runCursorSep + "not-a-uuid"); err == nil {
		t.Fatal("cursor with bad id should error")
	}
}
