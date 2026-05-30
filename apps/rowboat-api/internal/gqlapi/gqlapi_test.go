package gqlapi_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/gqlapi"
	"go.uber.org/zap"
)

func TestGraphQLUsersQuery(t *testing.T) {
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:gqltest?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })

	ctx := context.Background()
	d.Client.User.Create().SetEmail("admin@x.co").SetWorkosUserID("u1").SaveX(ctx)

	h := gqlapi.NewHandler(d.Client)

	query := `{"query":"{ users(first:10){ totalCount edges { node { id email } } } }"}`
	req := httptest.NewRequest(http.MethodPost, "/graphql", strings.NewReader(query)).
		WithContext(auth.WithInternal(ctx)) // internal context bypasses tenant scoping
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if strings.Contains(body, `"errors"`) {
		t.Fatalf("graphql errors: %s", body)
	}
	if !strings.Contains(body, "admin@x.co") {
		t.Fatalf("expected user in response: %s", body)
	}
	if !strings.Contains(body, `"totalCount":1`) {
		t.Fatalf("expected totalCount 1: %s", body)
	}
}
