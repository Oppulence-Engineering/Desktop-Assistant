//go:build pgconcurrency

package entities

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/entity"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"go.uber.org/zap"
)

// TestPgConcurrentSameEntityUnionsDistinctEvidence verifies the RFC 022
// convergence invariant against real PostgreSQL transaction and uniqueness
// semantics. Run with:
//
//	go test -tags=pgconcurrency -race ./internal/entities -run TestPgConcurrentSameEntity
func TestPgConcurrentSameEntityUnionsDistinctEvidence(t *testing.T) {
	dsn := os.Getenv("ROWBOAT_TEST_PG_DSN")
	if dsn == "" {
		t.Skip("ROWBOAT_TEST_PG_DSN not set; skipping Postgres entity concurrency test")
	}
	sqlDB, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	schemaClient := ent.NewClient(ent.Driver(entsql.OpenDB(dialect.Postgres, sqlDB)))
	if err := schemaClient.Schema.Create(context.Background()); err != nil {
		_ = schemaClient.Close()
		t.Fatalf("create schema: %v", err)
	}
	if err := schemaClient.Close(); err != nil {
		t.Fatal(err)
	}
	database, err := db.Open(context.Background(), appconfig.Config{DatabaseURL: dsn, AutoMigrate: false}, zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })

	nonce := fmt.Sprintf("%s-%d", t.Name(), time.Now().UnixNano())
	internal := auth.WithInternal(context.Background())
	user := database.Client.User.Create().
		SetEmail(nonce + "@example.com").
		SetWorkosUserID("user-" + nonce).
		SetWorkosOrgID("org-" + nonce).
		SaveX(internal)
	workspace := database.Client.RevenueWorkspace.Create().SetUser(user).SetWorkosOrgID(user.WorkosOrgID).SaveX(internal)
	database.Client.RevenueWorkspaceMember.Create().SetWorkspace(workspace).SetUser(user).SetRole("owner").SetStatus("active").SaveX(internal)
	service := New(database.Client, func(ctx context.Context) (Scope, error) {
		auth.GrantRevenueWorkspace(ctx, workspace.ID, "owner")
		return Scope{Workspace: workspace, User: user}, nil
	}, func(context.Context, Scope, Operation) error { return nil })
	digest := fmt.Sprintf("%X", sha256.Sum256([]byte(nonce)))
	entityID := digest[:26]

	start := make(chan struct{})
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for _, tc := range []struct {
		name string
		ref  string
	}{{"Acme Conduit", "conduit:company:" + nonce}, {"Acme Cadence", "cadence:vendor:" + nonce}} {
		tc := tc
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			fingerprint := fmt.Sprintf("sha256:v1:%x", sha256.Sum256([]byte(strings.ToLower(tc.name))))
			ctx := auth.WithUser(context.Background(), user)
			_, upsertErr := service.Upsert(ctx, entityID, Projection{
				Kind: "company", DisplayName: tc.name,
				ResourceRefs: []string{tc.ref},
				Identifiers:  map[string][]string{"emailDomain": {fingerprint}},
			})
			errs <- upsertErr
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent upsert: %v", err)
		}
	}
	view, err := service.Get(auth.WithUser(context.Background(), user), entityID)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.ResourceRefs) != 2 || len(view.Identifiers["emailDomains"]) != 2 {
		t.Fatalf("lost concurrent evidence: refs=%v identifiers=%v", view.ResourceRefs, view.Identifiers)
	}
	row := database.Client.Entity.Query().
		Where(entity.EntityIDEQ(entityID), entity.HasWorkspaceWith(revenueworkspace.IDEQ(workspace.ID))).
		OnlyX(internal)
	refs := row.QueryNormalizedResourceRefs().AllX(internal)
	identifiers := row.QueryNormalizedIdentifiers().AllX(internal)
	if len(refs) != len(view.ResourceRefs) || len(identifiers) != len(view.Identifiers["emailDomains"]) {
		t.Fatalf(
			"normalized storage diverged from projection: projection refs=%v identifiers=%v normalized refs=%d identifiers=%d",
			view.ResourceRefs,
			view.Identifiers,
			len(refs),
			len(identifiers),
		)
	}
}
