package revenue

import (
	"testing"
	"time"
)

// last_touch_at drives the quiet_account detector. Before this it was written only
// at relationship creation, so an account that had been talked to yesterday still
// reported months of silence.
func TestLastTouchAtTracksNewEvidence(t *testing.T) {
	f := newFixture(t)
	base := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)

	results, err := f.svc.IngestRelationshipObservations(f.ctx, f.user,
		[]RelationshipObservationInput{personObservation("obs_1", "Acme", "acme.example", base)},
	)
	if err != nil {
		t.Fatalf("first ingest: %v", err)
	}
	rel := results[0].Relationship
	if rel.LastTouchAt == nil || !rel.LastTouchAt.UTC().Equal(base) {
		t.Fatalf("last_touch_at = %v, want %v", rel.LastTouchAt, base)
	}

	later := base.Add(72 * time.Hour)
	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user,
		[]RelationshipObservationInput{personObservation("obs_2", "Acme", "acme.example", later)},
	); err != nil {
		t.Fatalf("second ingest: %v", err)
	}
	refreshed, err := f.client.Relationship.Get(f.ctx, rel.ID)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if refreshed.LastTouchAt == nil || !refreshed.LastTouchAt.UTC().Equal(later) {
		t.Fatalf("last_touch_at = %v, want it to advance to %v", refreshed.LastTouchAt, later)
	}
}

// Out-of-order delivery must not rewind the account's recency.
func TestLastTouchAtDoesNotRewindOnBackfill(t *testing.T) {
	f := newFixture(t)
	recent := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	old := recent.Add(-30 * 24 * time.Hour)

	results, err := f.svc.IngestRelationshipObservations(f.ctx, f.user,
		[]RelationshipObservationInput{personObservation("obs_recent", "Acme", "acme.example", recent)},
	)
	if err != nil {
		t.Fatalf("ingest recent: %v", err)
	}
	rel := results[0].Relationship

	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user,
		[]RelationshipObservationInput{personObservation("obs_old", "Acme", "acme.example", old)},
	); err != nil {
		t.Fatalf("ingest old: %v", err)
	}
	refreshed, err := f.client.Relationship.Get(f.ctx, rel.ID)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if !refreshed.LastTouchAt.UTC().Equal(recent) {
		t.Fatalf("a backfilled older observation rewound last_touch_at to %v", refreshed.LastTouchAt)
	}
}
