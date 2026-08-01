package revenue

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
)

func TestBetaDiagnosticsAreSupportSafeAndRoleRestricted(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 1, 15, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		DisplayName: "Secret Account Name", AccountDomain: "secret-customer.example",
		PrimaryEmail: "private@secret-customer.example", Source: "hubspot",
		SourceAccountID: "portal-safe-id", ExternalID: "provider-record-secret",
		EventType: "company.updated", OccurredAt: now, ReceivedAt: now,
		Summary: "Raw evidence must never appear in a support bundle.",
		Payload: json.RawMessage(`{"access_token":"never-export-me"}`),
	}}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.MarkSourceSyncFailure(f.ctx, f.user, "hubspot", "portal-safe-id", "provider_outage"); err != nil {
		t.Fatal(err)
	}
	diagnostics, err := f.svc.BetaDiagnostics(f.ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	if diagnostics.SchemaVersion != betaDiagnosticsSchemaVersion || diagnostics.WorkspaceRef == "" || len(diagnostics.Sources) != 1 {
		t.Fatalf("incomplete support bundle: %+v", diagnostics)
	}
	raw, err := json.Marshal(diagnostics)
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	for _, secret := range []string{
		"Secret Account Name", "secret-customer.example", "private@", "Raw evidence",
		"never-export-me", "provider-record-secret", "portal-safe-id",
	} {
		if strings.Contains(text, secret) {
			t.Fatalf("support diagnostics leaked customer content %q: %s", secret, text)
		}
	}
	if source := diagnostics.Sources[0]; !strings.HasPrefix(source.ConnectionRef, "connection:sha256:") ||
		!strings.HasPrefix(source.SourceAccountRef, "source-account:sha256:") {
		t.Fatalf("source identifiers were not reduced to one-way support refs: %+v", source)
	}

	viewer := newUser(t, f.client, "diagnostics-viewer@example.com", "diagnostics_viewer")
	if _, err := f.svc.UpsertWorkspaceMember(f.ctx, f.user, viewer.ID, "viewer"); err != nil {
		t.Fatal(err)
	}
	viewerCtx := auth.WithUser(f.ctx, viewer)
	if _, err := f.svc.BetaDiagnostics(viewerCtx, viewer); !errors.Is(err, ErrForbidden) {
		t.Fatalf("viewer exported workspace diagnostics: %v", err)
	}
}
