package revenue

import (
	"net/http"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
)

// waitForScan polls a scan to its terminal state, the way the production runner
// finishes asynchronously.
func waitForScan(t *testing.T, f *fixture, id interface{ String() string }) string {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		got, err := f.svc.GetScan(f.ctx, mustParseUUID(t, id.String()))
		if err != nil {
			t.Fatalf("get scan: %v", err)
		}
		if got.Status == "completed" || got.Status == "failed" {
			return got.Status
		}
		if time.Now().After(deadline) {
			t.Fatalf("scan did not finish: %s", got.Status)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func googleSourceStatus(t *testing.T, f *fixture) string {
	t.Helper()
	statuses, err := f.svc.RelationshipSourceStatuses(f.ctx, f.user)
	if err != nil {
		t.Fatalf("source statuses: %v", err)
	}
	for _, s := range statuses {
		if s.Source == "google" {
			return s.Status
		}
	}
	return ""
}

// A dead Google grant is the one scan failure the user can fix. Before this,
// the 401 was recorded on the scan row and nowhere else: the commitments screen
// showed an empty register with no explanation, and the connections screen went
// on reporting the account as healthy. The scan must mark the source so every
// surface tells the same story.
func TestScanMarksGoogleReconnectRequiredOnAuthFailure(t *testing.T) {
	f := newFixture(t)
	f.svc.SetSweeper(&fakeSweeper{err: &googleapi.APIError{
		Path:       "/gmail/v1/users/me/threads",
		StatusCode: http.StatusUnauthorized,
		Message:    "Request had invalid authentication credentials.",
	}})

	scan, err := f.svc.StartScan(f.ctx, f.user, 90)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if got := waitForScan(t, f, scan.ID); got != "failed" {
		t.Fatalf("scan status = %s, want failed", got)
	}
	if got := googleSourceStatus(t, f); got != "reconnect_required" {
		t.Fatalf("google source status = %q, want reconnect_required", got)
	}
}

// A transient provider fault is not a reason to send the user back through
// OAuth. Only an auth failure may demand a reconnect; anything else retries.
func TestScanDoesNotDemandReconnectOnATransientFailure(t *testing.T) {
	f := newFixture(t)
	f.svc.SetSweeper(&fakeSweeper{err: &googleapi.APIError{
		Path:       "/gmail/v1/users/me/threads",
		StatusCode: http.StatusServiceUnavailable,
		Message:    "Backend Error",
	}})

	scan, err := f.svc.StartScan(f.ctx, f.user, 90)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if got := waitForScan(t, f, scan.ID); got != "failed" {
		t.Fatalf("scan status = %s, want failed", got)
	}
	if got := googleSourceStatus(t, f); got == "reconnect_required" {
		t.Fatal("a 503 sent the user back through OAuth")
	}
}

// IsAuthError must key on the status code, not on message text, or the next
// wording change from Google silently breaks the reconnect prompt.
func TestIsAuthErrorClassifiesByStatusCode(t *testing.T) {
	for _, tc := range []struct {
		code int
		want bool
	}{
		{http.StatusUnauthorized, true},
		{http.StatusForbidden, true},
		{http.StatusTooManyRequests, false},
		{http.StatusServiceUnavailable, false},
		{http.StatusBadRequest, false},
	} {
		err := &googleapi.APIError{Path: "/x", StatusCode: tc.code}
		if got := googleapi.IsAuthError(err); got != tc.want {
			t.Errorf("IsAuthError(%d) = %v, want %v", tc.code, got, tc.want)
		}
	}
	if googleapi.IsAuthError(nil) {
		t.Error("nil classified as an auth error")
	}
}

// Staleness is derived from the clock. A dead grant guarantees staleness — no
// sync can succeed — so letting freshness overwrite the state hid the one fact
// the user could act on behind the symptom it caused. This is the last link in
// the chain: without it the scan marks reconnect_required and the API still
// reports "stale".
func TestFreshnessDoesNotMaskReconnectRequired(t *testing.T) {
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	longAgo := now.Add(-72 * time.Hour)

	needsReconnect := &ent.RelationshipSourceStatus{
		Status:                 "reconnect_required",
		Completeness:           "partial",
		ExpectedCadenceSeconds: 900,
		LastSuccessAt:          &longAgo,
	}
	applySourceFreshness(needsReconnect, now)
	if needsReconnect.Status != "reconnect_required" {
		t.Fatalf("status = %q, want reconnect_required", needsReconnect.Status)
	}
	if needsReconnect.Completeness != "stale" {
		t.Fatalf("completeness = %q, want stale", needsReconnect.Completeness)
	}
	if needsReconnect.LagSeconds == 0 {
		t.Fatal("lag was not recorded")
	}

	// An ordinary connected source still goes stale on the same clock.
	connected := &ent.RelationshipSourceStatus{
		Status:                 "connected",
		Completeness:           "partial",
		ExpectedCadenceSeconds: 900,
		LastSuccessAt:          &longAgo,
	}
	applySourceFreshness(connected, now)
	if connected.Status != "stale" {
		t.Fatalf("connected source status = %q, want stale", connected.Status)
	}
}
