package revenue

import (
	"fmt"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
)

// The refresh endpoint answers a revoked grant with invalid_grant, which never
// reaches an API path and so carries no status code. The executor used to
// replace that sentinel with a fresh string, and the scan failed every day
// with a generic message while the connection card said "Active".
//
// The grant here was claimed by the web app, which never reports its
// authorization, so no source row exists to mark. The scan must create one per
// real Google account so every surface tells the same story.
func TestScanMarksGoogleReconnectRequiredWhenTheRefreshTokenIsDead(t *testing.T) {
	f := newFixture(t)
	f.client.OAuthConnection.Create().
		SetUser(f.user).
		SetProvider("google").
		SetRefreshTokenEncrypted([]byte("x")).
		SetScopes([]string{scopeGmailReadonly}).
		SetExternalAccountID("owner@x.co").
		SaveX(f.ctx)
	// The exact error the Gmail executor returns for a dead refresh token.
	f.svc.SetSweeper(&fakeSweeper{err: fmt.Errorf(
		"revenue: google refresh token is invalid; reconnect Google: %w", googleapi.ErrReconnectRequired,
	)})

	scan, err := f.svc.StartScan(f.ctx, f.user, 90)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if got := waitForScan(t, f, scan.ID); got != "failed" {
		t.Fatalf("scan status = %s, want failed", got)
	}
	if got := googleSourceStatuses(t, f); got["owner@x.co"] != "reconnect_required" {
		t.Fatalf("google source statuses = %v, want owner@x.co reconnect_required", got)
	}
	row, err := f.svc.GetScan(f.ctx, scan.ID)
	if err != nil {
		t.Fatalf("get scan: %v", err)
	}
	if got := UserSafeScanError(row.Error); !strings.Contains(got, "reconnect") {
		t.Fatalf("user-safe error = %q, want a reconnect prompt", got)
	}
}
