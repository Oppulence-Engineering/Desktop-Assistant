//go:build postgresintegration

package account_test

import (
	"context"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/creditledger"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mailthread"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personinteractionstat"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipparticipant"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/userhistory"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
)

// TestAccountDeletionOnPostgres proves the cascade on the real migrations.
// PostgreSQL checks NO ACTION foreign keys (for example participants ->
// relationships) at the end of the statement, after the cascade; SQLite cannot
// prove that. Run against a database migrated with `go run ./cmd/migrate apply`:
//
//	ROWBOAT_TEST_PG_DSN=postgres://... go test -tags postgresintegration ./internal/account/
func TestAccountDeletionOnPostgres(t *testing.T) {
	dsn := os.Getenv("ROWBOAT_TEST_PG_DSN")
	if dsn == "" {
		t.Skip("ROWBOAT_TEST_PG_DSN is required")
	}
	database, err := db.Open(context.Background(), appconfig.Config{DatabaseURL: dsn}, zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	suffix := uuid.NewString()[:8]

	t.Run("solo account", func(t *testing.T) {
		h := newHarnessWith(t, database)
		gone := newUser(h.client, "pg-gone-"+suffix)
		ws := newWorkspace(h.client, gone)
		rel := h.client.Relationship.Create().SetWorkspace(ws).SetUser(gone).SetKind("company").SetDisplayName("Acme").SaveX(internal)
		person := h.client.Person.Create().SetWorkspace(ws).SetUser(gone).SetDisplayName("Ada").SetPrimaryEmail("ada@acme.test").SaveX(internal)
		h.client.RelationshipParticipant.Create().SetWorkspace(ws).SetUser(gone).SetRelationship(rel).SetPerson(person).
			SetDisplayName("Ada").SetEmail("ada@acme.test").SetRole("champion").SaveX(internal)
		now := time.Now().UTC()
		h.client.PersonInteractionStat.Create().SetWorkspace(ws).SetPerson(person).SetRelationship(rel).
			SetFirstInteractionAt(now.Add(-time.Hour)).SetLastInteractionAt(now).SetInteractionCount(1).
			SetInboundCount(1).SetOutboundCount(0).SetChannelCounts(map[string]int{"email": 1}).
			SetLastChannel("email").SetLastDirection("inbound").SaveX(internal)
		thread := h.client.MailThread.Create().SetUser(gone).SetProviderThreadID("pg-thread-" + suffix).SetSubject("Renewal").
			SetCounterpartyEmail("ada@acme.test").SetRelationship(rel).SaveX(internal)
		entry := h.client.CreditLedger.Create().SetUser(gone).SetDelta(-10).SetReason("llm_call.reserve").
			SetRequestID(uuid.New()).SetTs(now).SaveX(internal)

		rec, receipt := h.deleteAccount(t, gone, "DELETE")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
		if receipt.WorkspacesDeleted != 1 {
			t.Fatalf("receipt = %+v", receipt)
		}
		gonePredicates := map[string]bool{
			"user":                 h.client.User.Query().Where(user.IDEQ(gone.ID)).ExistX(internal),
			"workspace":            h.client.RevenueWorkspace.Query().Where(revenueworkspace.IDEQ(ws.ID)).ExistX(internal),
			"relationship":         h.client.Relationship.Query().Where(relationship.IDEQ(rel.ID)).ExistX(internal),
			"participant":          h.client.RelationshipParticipant.Query().Where(relationshipparticipant.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID))).ExistX(internal),
			"interaction_stat":     h.client.PersonInteractionStat.Query().Where(personinteractionstat.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID))).ExistX(internal),
			"mail_thread":          h.client.MailThread.Query().Where(mailthread.IDEQ(thread.ID)).ExistX(internal),
			"credit_ledger":        h.client.CreditLedger.Query().Where(creditledger.IDEQ(entry.ID)).ExistX(internal),
			"user_history_for_ref": h.client.UserHistory.Query().Where(userhistory.RefEQ(gone.ID)).ExistX(internal),
		}
		for name, exists := range gonePredicates {
			if exists {
				t.Errorf("%s still exists after account deletion", name)
			}
		}
	})

	t.Run("shared workspace", func(t *testing.T) {
		h := newHarnessWith(t, database)
		owner := newUser(h.client, "pg-owner-"+suffix)
		member := newUser(h.client, "pg-member-"+suffix)
		ws := newWorkspace(h.client, owner)
		h.client.RevenueWorkspaceMember.Create().SetWorkspace(ws).SetUser(member).SetRole("member").SetStatus("active").SaveX(internal)
		rel := h.client.Relationship.Create().SetWorkspace(ws).SetUser(owner).SetKind("company").SetDisplayName("Acme").SaveX(internal)
		person := h.client.Person.Create().SetWorkspace(ws).SetUser(owner).SetDisplayName("Ada").SetPrimaryEmail("ada@acme.test").SaveX(internal)
		participant := h.client.RelationshipParticipant.Create().SetWorkspace(ws).SetUser(member).SetRelationship(rel).SetPerson(person).
			SetDisplayName("Ada").SetEmail("ada@acme.test").SetRole("champion").SaveX(internal)

		rec, receipt := h.deleteAccount(t, owner, "DELETE")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
		if receipt.WorkspacesTransferred != 1 {
			t.Fatalf("receipt = %+v", receipt)
		}
		if got := h.client.RevenueWorkspace.Query().Where(revenueworkspace.IDEQ(ws.ID)).QueryUser().OnlyIDX(internal); got != member.ID {
			t.Fatalf("workspace owner = %s, want member", got)
		}
		if got := h.client.Relationship.Query().Where(relationship.IDEQ(rel.ID)).QueryUser().OnlyIDX(internal); got != member.ID {
			t.Fatalf("relationship author = %s, want member", got)
		}
		if !h.client.RelationshipParticipant.Query().Where(relationshipparticipant.IDEQ(participant.ID)).ExistX(internal) {
			t.Fatal("member's participant row was deleted")
		}
	})
}
